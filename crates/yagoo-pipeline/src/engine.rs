//! Analysis protocol boundary. Local futures allow browser JS/ORT promises.
use futures::future::LocalBoxFuture;
use yagoo_katago::{AnalysisQuery, AnalysisResponse, AnalysisUpdate, KatagoError, KatagoResult};

pub type UpdateCallback<'a> = dyn FnMut(AnalysisUpdate) -> KatagoResult<()> + 'a;

/// Engines emit partials followed by exactly one final response, or return an error.
/// Dropping the future cancels work owned by that query.
pub trait AnalysisEngine {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>>;

    fn analyze<'a>(
        &'a self,
        query: &'a AnalysisQuery,
    ) -> LocalBoxFuture<'a, KatagoResult<AnalysisResponse>> {
        Box::pin(async move {
            let mut response = None;
            self.analyze_streaming(query, &mut |update| {
                if let AnalysisUpdate::Final(value) = update {
                    response = Some(value);
                }
                Ok(())
            })
            .await?;
            response.ok_or(KatagoError::MissingField("final response"))
        })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl AnalysisEngine for yagoo_katago::AnalysisClient {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            yagoo_katago::AnalysisClient::analyze_streaming(self, query, on_update).await
        })
    }
}
