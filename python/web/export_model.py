"""Export the official KataGo SWA model, never random/unaveraged weights.

Uses upstream KataGo (MIT), supplied separately via --katago-source. No AGPL
exporter is used. Run with `uv run --extra web python web/export_model.py --help`.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

HEADS = ["policy", "value", "miscvalue", "moremiscvalue", "ownership",
         "scoring", "futurepos", "seki", "scorebelief_logprobs"]
MODEL = "kata1-b18c384nbt-s9996604416-d4316597426"
SOURCE = f"https://media.katagotraining.org/uploaded/networks/zips/kata1/{MODEL}.zip"
CHECKPOINT_SHA256 = "ed3f2681be01604fd51b467925de77cea4f19cf125383493449d8c002fb91a24"


def verify_checkpoint(path: Path) -> str:
    """Bind the published model identity to the selected official checkpoint."""
    with path.open("rb") as checkpoint:
        digest = hashlib.file_digest(checkpoint, "sha256").hexdigest()
    if digest != CHECKPOINT_SHA256:
        raise ValueError(f"Expected official {MODEL} checkpoint SHA-256 {CHECKPOINT_SHA256}; got {digest}")
    return digest


def artifact(path: Path) -> dict:
    digest = hashlib.sha256(path.read_bytes()).digest()
    return {"url": path.name, "bytes": path.stat().st_size,
            "sha256": digest.hex(), "integrity": "sha256-" + base64.b64encode(digest).decode()}


def decompose(model):
    """Stable softplus and log-softmax primitives supported by the WebGPU EP."""
    import onnx
    from onnx import helper, numpy_helper
    import numpy as np
    nodes = []
    for i, node in enumerate(model.graph.node):
        prefix = f"yagoo_decomposed_{i}"
        if node.op_type not in ("Softplus", "LogSoftmax", "ReduceLogSumExp"):
            nodes.append(node)
            continue
        x, y = node.input[0], node.output[0]
        if node.op_type == "Softplus":
            one = prefix + "_one"
            model.graph.initializer.append(numpy_helper.from_array(np.array(1, dtype=np.float32), one))
            nodes += [helper.make_node(op, ins, [out]) for op, ins, out in [
                ("Abs", [x], prefix + "_abs"),
                ("Neg", [prefix + "_abs"], prefix + "_neg"),
                ("Exp", [prefix + "_neg"], prefix + "_exp"),
                ("Add", [prefix + "_exp", one], prefix + "_add"),
                ("Log", [prefix + "_add"], prefix + "_log"),
                ("Relu", [x], prefix + "_relu"),
                ("Add", [prefix + "_relu", prefix + "_log"], y),
            ]]
        elif node.op_type == "LogSoftmax":
            # ORT WebGPU 1.30 ReduceLogSumExp uses an unshifted exp reduction.
            # Keep exp inputs <= 0 explicitly, also avoiding log(softmax(x))
            # underflow in fp16. Do not rely on the EP stabilizing the reduction.
            axis = next((a.i for a in node.attribute if a.name == "axis"), -1)
            axes = prefix + "_axes"
            model.graph.initializer.append(numpy_helper.from_array(np.array([axis], dtype=np.int64), axes))
            nodes += [
                helper.make_node("ReduceMax", [x], [prefix + "_max"], axes=[axis], keepdims=1),
                helper.make_node("Sub", [x, prefix + "_max"], [prefix + "_shifted"]),
                helper.make_node("Exp", [prefix + "_shifted"], [prefix + "_exp"]),
                helper.make_node("ReduceSum", [prefix + "_exp", axes], [prefix + "_sum"], keepdims=1),
                helper.make_node("Log", [prefix + "_sum"], [prefix + "_log"]),
                helper.make_node("Sub", [prefix + "_shifted", prefix + "_log"], [y]),
            ]
        elif node.op_type == "ReduceLogSumExp":
            # The score-belief mixture contains its own logsumexp, independent
            # of LogSoftmax. Stabilize it too; negative fp16 inputs can underflow
            # to an all-zero exp sum in ORT's WebGPU reduction.
            axes_value = next((list(a.ints) for a in node.attribute if a.name == "axes"), None)
            keepdims = next((a.i for a in node.attribute if a.name == "keepdims"), 1)
            axes = prefix + "_axes"
            if axes_value is not None:
                model.graph.initializer.append(numpy_helper.from_array(np.array(axes_value, dtype=np.int64), axes))
            axis_args = [axes] if axes_value is not None else []
            axis_attr = {"axes": axes_value} if axes_value is not None else {}
            result = y if keepdims else prefix + "_kept"
            nodes += [
                helper.make_node("ReduceMax", [x], [prefix + "_max"], keepdims=1, **axis_attr),
                helper.make_node("Sub", [x, prefix + "_max"], [prefix + "_shifted"]),
                helper.make_node("Exp", [prefix + "_shifted"], [prefix + "_exp"]),
                helper.make_node("ReduceSum", [prefix + "_exp"] + axis_args, [prefix + "_sum"], keepdims=1),
                helper.make_node("Log", [prefix + "_sum"], [prefix + "_log"]),
                helper.make_node("Add", [prefix + "_max", prefix + "_log"], [result]),
            ]
            if not keepdims:
                nodes.append(helper.make_node("Squeeze", [result] + axis_args, [y]))
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    onnx.checker.check_model(model)
    return model


def fp16_model(model):
    from onnx import TensorProto, helper
    from onnxconverter_common import float16
    # Only redundant float->float casts: input graph is wholly fp32.
    for node in model.graph.node:
        if node.op_type == "Cast" and any(a.name == "to" and a.i == TensorProto.FLOAT for a in node.attribute):
            node.op_type = "Identity"
            del node.attribute[:]
    # Graph outputs must not force internal activation branches to remain fp32.
    for output in model.graph.output:
        internal = output.name + "_internal"
        for node in model.graph.node:
            for i, value in enumerate(node.input):
                if value == output.name:
                    node.input[i] = internal
            for i, value in enumerate(node.output):
                if value == output.name:
                    node.output[i] = internal
        for value in model.graph.value_info:
            if value.name == output.name:
                value.name = internal
        model.graph.node.append(helper.make_node("Identity", [internal], [output.name]))
    return float16.convert_float_to_float16(model, keep_io_types=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--katago-source", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--trunk", action="store_true")
    parser.add_argument("--batch", type=int, default=1, help="0 for dynamic batches of 1..4, otherwise fixed batch 1")
    parser.add_argument("--fp16", action="store_true")
    args = parser.parse_args()
    if args.batch not in (0, 1):
        parser.error("batch must be 0 (dynamic) or 1")
    checkpoint_digest = verify_checkpoint(args.checkpoint)
    sys.path.insert(0, str(args.katago_source.resolve() / "python"))
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from katago.train.load_model import load_model
    from katago.train.model_pytorch import ExtraOutputs

    torch.set_num_threads(4)
    _, model, _ = load_model(str(args.checkpoint), use_swa=True, device="cpu", pos_len=19)
    model.eval()
    if model.config["version"] not in (14, 15) or model.c_trunk != 384 or model.num_total_blocks != 18:
        raise ValueError("This manifest contract is for the selected b18c384nbt SWA model")
    names = ([f"trunk_after_block{i}" for i in range(18)] + ["trunkfinal"]) if args.trunk else []

    class Wrap(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = model

        def forward(self, spatial, global_input):
            extras = ExtraOutputs(names)
            heads = self.model(spatial, global_input, extra_outputs=extras)[0]
            return tuple(heads) + tuple(extras.returned[name] for name in names)

    args.out.mkdir(parents=True, exist_ok=True)
    # Valid empty-board V7 input. Additional midgame reference inputs are emitted
    # by the feature-golden generator; this is a numerical export check, not strength validation.
    spatial = np.zeros((max(1, args.batch), 22, 19, 19), dtype=np.float32)
    spatial[:, 0] = 1
    global_input = np.zeros((max(1, args.batch), 19), dtype=np.float32)
    global_input[:, 5:8] = [-7.5 / 20, 1, 0.5]
    global_input[:, 18] = 0.5
    tensors = (torch.from_numpy(spatial), torch.from_numpy(global_input))
    wrapper = Wrap().eval()
    with torch.no_grad():
        reference = [x.numpy() for x in wrapper(*tensors)]
    all_outputs = HEADS + names
    path = args.out / "model.fp32.onnx"
    dynamic = {name: {0: "N"} for name in ["spatial", "global_input"] + all_outputs} if args.batch == 0 else None
    with torch.no_grad():
        torch.onnx.export(wrapper, tensors, str(path), input_names=["spatial", "global_input"],
                          output_names=all_outputs, opset_version=17, dynamo=False, dynamic_axes=dynamic)
    onnx.save(decompose(onnx.load(path)), path)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    feeds = {"spatial": spatial, "global_input": global_input}
    report = {}
    session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    values = session.run(all_outputs, feeds)
    for name, actual, expected in zip(all_outputs, values, reference):
        np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-4, err_msg=name)
    report["fp32MaxAbs"] = {name: float(np.max(np.abs(a - b))) for name, a, b in zip(all_outputs, values, reference)}
    if args.batch == 0:
        # Different valid positions catch cross-row mixing and traced batch=1
        # reshape constants. Check PyTorch and separate ONNX single-row calls.
        fixtures = json.loads((Path(__file__).resolve().parents[2] / "crates/yagoo-core/tests/fixtures/v7.json").read_text())
        positions = [fixtures[i] for i in [0, 5, 13, 23]]
        batch_spatial = np.zeros((4, 22 * 361), dtype=np.float32)
        for row, position in enumerate(positions):
            batch_spatial[row, position["spatial"]] = 1
        batch_spatial = batch_spatial.reshape(4, 22, 19, 19)
        batch_global = np.array([p["globalInput"] for p in positions], dtype=np.float32)
        report["batchMaxAbs"] = {}
        for count in [2, 3, 4]:
            feeds_batch = {"spatial": batch_spatial[:count], "global_input": batch_global[:count]}
            with torch.no_grad():
                reference_batch = [x.numpy() for x in wrapper(torch.from_numpy(feeds_batch["spatial"]), torch.from_numpy(feeds_batch["global_input"]))]
            actual_batch = session.run(all_outputs, feeds_batch)
            maximum = 0.0
            for name, actual, expected in zip(all_outputs, actual_batch, reference_batch):
                np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-4, err_msg=f"batch {count} {name}")
                maximum = max(maximum, float(np.max(np.abs(actual - expected))))
            for row in range(count):
                singles = session.run(all_outputs, {name: value[row:row+1] for name, value in feeds_batch.items()})
                for name, actual, single in zip(all_outputs, actual_batch, singles):
                    np.testing.assert_allclose(actual[row:row+1], single, rtol=2e-4, atol=2e-4, err_msg=f"row {row} {name}")
            report["batchMaxAbs"][str(count)] = maximum
    variants = {"fp32": artifact(path)}
    if args.fp16:
        optimized = args.out / "optimized.fp32.onnx"
        options.optimized_model_filepath = str(optimized)
        ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
        half = args.out / "model.fp16.onnx"
        onnx.save(fp16_model(onnx.load(optimized)), half)
        onnx.checker.check_model(str(half))
        options.optimized_model_filepath = ""
        session16 = ort.InferenceSession(str(half), options, providers=["CPUExecutionProvider"])
        values16 = session16.run(all_outputs, feeds)
        # Compare semantic heads. Raw fp16 logit/activation error has a different scale.
        def softmax(x):
            exp = np.exp(x - x.max(axis=-1, keepdims=True))
            return exp / exp.sum(axis=-1, keepdims=True)
        for idx in [0, 1, 8]:
            np.testing.assert_allclose(softmax(values16[idx]), softmax(reference[idx]), atol=0.005, rtol=0.02)
        np.testing.assert_allclose(np.tanh(values16[4]), np.tanh(reference[4]), atol=0.01, rtol=0.02)
        np.testing.assert_allclose(values16[2][:, 2] * model.lead_multiplier,
                                   reference[2][:, 2] * model.lead_multiplier, atol=0.1, rtol=0.01)
        report["fp16MaxAbs"] = {name: float(np.max(np.abs(a - b))) for name, a, b in zip(all_outputs, values16, reference)}
        variants["fp16"] = artifact(half)
        optimized.unlink()
    np.savez(args.out / "reference.npz", spatial=spatial, global_input=global_input,
             **dict(zip(all_outputs, reference)))
    warmup = {"spatial": spatial[0].reshape(-1).tolist(), "globalInput": global_input[0].tolist(),
              "outputs": {name: v[0].reshape(-1).tolist() for name, v in zip(HEADS, reference)}}
    (args.out / "warmup.json").write_text(json.dumps(warmup), encoding="utf-8")
    revision = subprocess.check_output(["git", "-C", str(args.katago_source), "rev-parse", "HEAD"], text=True).strip()
    manifest = {"schemaVersion": 1, "model": MODEL, "source": SOURCE, "swa": True,
                "checkpointSha256": checkpoint_digest,
                "upstreamRevision": revision, "modelVersion": model.config["version"], "inputVersion": 7,
                "boardSize": 19, "batch": args.batch, "maxBatch": 4 if args.batch == 0 else 1, "outputs": all_outputs, "variants": variants,
                "warmup": artifact(args.out / "warmup.json"),
                "postprocess": {name: float(getattr(model, name)) for name in [
                    "scoremean_multiplier", "scorestdev_multiplier", "lead_multiplier",
                    "variance_time_multiplier", "shortterm_value_error_multiplier", "shortterm_score_error_multiplier"]},
                "license": "KATAGO_NETWORK_LICENSE.txt"}
    shutil.copyfile(Path(__file__).with_name("KATAGO_NETWORK_LICENSE.txt"), args.out / manifest["license"])
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (args.out / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(args.out / "manifest.json"), "variants": variants, "validation": report}))


if __name__ == "__main__":
    main()
