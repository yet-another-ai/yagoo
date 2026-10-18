# Browser distribution notices

These unchanged files come from the ONNX Runtime 1.30.0 source release, matching
the pinned `onnxruntime-web` dependency. Its npm package does not contain these
notices. The complete upstream third-party notice is retained; some listed
components apply to other ONNX Runtime builds rather than the browser build.

- `onnxruntime-1.30.0/LICENSE`: https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE
  (SHA-256 `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`)
- `onnxruntime-1.30.0/ThirdPartyNotices.txt`: https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/ThirdPartyNotices.txt
  (SHA-256 `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3`)

Vite emits both files and the repository's KataGo code notice under `dist/licenses/`.
Model bundles separately retain `KATAGO_NETWORK_LICENSE.txt` from the exporter.
When upgrading the runtime, add the matching upstream release notices.
