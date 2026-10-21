# Third-party notices

The starter opening catalogue in `data/openings.json` is an original Yagoo
contribution under the repository's Apache-2.0 license, not an imported
third-party database. See `data/OPENINGS_PROVENANCE.md` for source review,
coverage, and redistribution information.

The V7 feature algorithms in `crates/yagoo-core/src/nn_features.rs` are adapted
from KataGo `python/katago/game/{board,features}.py` and
`cpp/neuralnet/nninputs.cpp`, revision d91ea855110dae533f0aada947b2b7d78cc8a4e1.
The exporter calls the separately installed upstream PyTorch implementation.
No Kaya / katago-onnx AGPL code is incorporated.

Copyright 2025 David J Wu ("lightvector") and/or other authors of the content in
the KataGo repository (https://github.com/lightvector/KataGo).

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The official network has a separate notice in
`python/web/KATAGO_NETWORK_LICENSE.txt`, copied into every exported model bundle.
