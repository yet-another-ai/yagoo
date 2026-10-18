use futures::{future::LocalBoxFuture, StreamExt};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use yagoo_core::nn_features::V7Features;
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, SearchEngine};

struct WebEvaluator {
    callback: js_sys::Function,
}
impl NnEvaluator for WebEvaluator {
    fn evaluate<'a>(
        &'a self,
        input: &'a V7Features,
    ) -> LocalBoxFuture<'a, Result<RawHeads, String>> {
        Box::pin(async move {
            let spatial = js_sys::Float32Array::from(input.spatial.as_slice());
            let global = js_sys::Float32Array::from(input.global.as_slice());
            let result = self
                .callback
                .call2(&JsValue::NULL, &spatial, &global)
                .map_err(|e| format!("{e:?}"))?;
            let json = JsFuture::from(js_sys::Promise::resolve(&result))
                .await
                .map_err(|e| format!("{e:?}"))?;
            serde_json::from_str(&json.as_string().ok_or("evaluator must return JSON heads")?)
                .map_err(|e| e.to_string())
        })
    }
}

/// Emits the same serialized PipelineEvent values as the CLI, inside one worker.
#[wasm_bindgen]
pub async fn analyze(
    sgf: String,
    config_json: String,
    postprocess_json: String,
    evaluator: js_sys::Function,
    emit: js_sys::Function,
) -> Result<(), JsValue> {
    let postprocess: Postprocess =
        serde_json::from_str(&postprocess_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let config =
        serde_json::from_str(&config_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    #[allow(clippy::arc_with_non_send_sync)]
    let engine = Arc::new(SearchEngine {
        evaluator: WebEvaluator {
            callback: evaluator,
        },
        postprocess,
    });
    let mut stream = yagoo_pipeline::analyze_game(&sgf, engine, config);
    while let Some(event) = stream.next().await {
        let json = serde_json::to_string(&event.map_err(|e| JsValue::from_str(&e.to_string()))?)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        emit.call1(&JsValue::NULL, &JsValue::from_str(&json))?;
    }
    Ok(())
}

#[wasm_bindgen]
pub fn default_config() -> Result<String, JsValue> {
    let mut config = yagoo_pipeline::PipelineConfig {
        scan_visits: 1,
        root_visits: 200,
        pv_end_visits: 100,
        report_during_search_every: Some(0.5),
        ..Default::default()
    };
    config.deep_select.max_deep_plies = 12;
    serde_json::to_string(&config).map_err(|e| JsValue::from_str(&e.to_string()))
}
