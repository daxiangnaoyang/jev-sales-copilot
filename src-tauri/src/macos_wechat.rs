use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, AnyThread};
use objc2_core_graphics::CGImage;
use objc2_foundation::{NSArray, NSDictionary, NSError, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCRunningApplication, SCScreenshotManager, SCShareableContent,
    SCStreamConfiguration, SCWindow,
};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
    VNRequestTextRecognitionLevel,
};
use serde::{Deserialize, Serialize};
use std::sync::{mpsc::sync_channel, Mutex};
use std::time::Duration;
use std::{collections::VecDeque, ffi::CString};
use tauri::command;

const WECHAT_BUNDLE: &str = "com.tencent.xinWeChat";
const WECHAT_NAMES: [&str; 3] = ["微信", "WeChat", "Weixin"];
const MIN_WINDOW_WIDTH: f64 = 600.0;
const MIN_WINDOW_HEIGHT: f64 = 400.0;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[repr(C)]
struct AXPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
struct AXSize {
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize)]
pub struct WeChatScan {
    pub window_title: String,
    pub conversation_title: Option<String>,
    pub text: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct WeChatCustomerCandidate {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct WeChatCustomerImport {
    pub window_title: String,
    pub customers: Vec<WeChatCustomerCandidate>,
    pub visible_rows: usize,
    pub skipped_group_rows: usize,
    pub skipped_uncertain_rows: usize,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ProviderCheck {
    pub ok: bool,
    pub message: String,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BochaSearchResultDto {
    pub title: String,
    pub url: String,
    pub site_name: String,
    pub snippet: String,
    pub summary: String,
    pub published_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BochaSearchResponseDto {
    pub results: Vec<BochaSearchResultDto>,
}

#[command]
pub fn request_screen_capture_access() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() }
}

#[command]
pub async fn bocha_search(
    query: String,
    api_key: String,
) -> Result<BochaSearchResponseDto, String> {
    let query = validate_bocha_query(&query)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("请先填写博查 API Key。".into());
    }
    let response = http_client()?
        .post("https://api.bochaai.com/v1/web-search")
        .bearer_auth(api_key)
        .json(&serde_json::json!({"query":query,"summary":true,"count":8}))
        .send()
        .await
        .map_err(|e| format!("博查搜索请求失败：{e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "博查返回内容不是有效 JSON。".to_string())?;
    if !status.is_success() {
        return Err(format!("博查搜索返回 {status}：{}", api_error(&payload)));
    }
    Ok(BochaSearchResponseDto {
        results: parse_bocha_search_results(&payload)?,
    })
}

fn validate_bocha_query(query: &str) -> Result<&str, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("请填写公开搜索词。".into());
    }
    if query.chars().count() > 200 {
        return Err("公开搜索词最多 200 个字符。".into());
    }
    Ok(query)
}

fn parse_bocha_search_results(
    payload: &serde_json::Value,
) -> Result<Vec<BochaSearchResultDto>, String> {
    let values = payload
        .get("webPages")
        .and_then(|pages| pages.get("value"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "博查响应缺少 webPages.value 搜索结果。".to_string())?;
    Ok(values
        .iter()
        .filter_map(|item| {
            let url = item.get("url")?.as_str()?.trim();
            if !url.starts_with("https://") {
                return None;
            }
            Some(BochaSearchResultDto {
                title: item.get("name")?.as_str()?.to_string(),
                url: url.to_string(),
                site_name: item
                    .get("siteName")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                snippet: item
                    .get("snippet")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                summary: item
                    .get("summary")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                published_date: item
                    .get("datePublished")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
            })
        })
        .take(8)
        .collect())
}

#[command]
pub async fn check_agent_provider(
    endpoint: String,
    api_key: String,
) -> Result<ProviderCheck, String> {
    let endpoint = validate_agent_endpoint(&endpoint)?;
    let url = if endpoint.ends_with("/chat/completions") {
        endpoint.trim_end_matches("/chat/completions").to_string() + "/models"
    } else if endpoint.ends_with("/models") {
        endpoint
    } else {
        format!("{}/models", endpoint.trim_end_matches('/'))
    };
    let loopback = reqwest::Url::parse(&url)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            })
        })
        .unwrap_or(false);
    let mut request = http_client()?.get(url);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    } else if !loopback {
        return Err("云端服务需要 API Key；仅本机回环地址可留空。".into());
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Agent 连通性检查失败：{e}"))?;
    provider_check(response, "Agent").await
}

async fn provider_check(response: reqwest::Response, label: &str) -> Result<ProviderCheck, String> {
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| format!("{label} 返回内容不是有效 JSON。"))?;
    if !status.is_success() {
        return Err(format!(
            "{label} 服务返回 {status}：{}",
            api_error(&payload)
        ));
    }
    let models = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                })
                .take(50)
                .collect()
        })
        .unwrap_or_default();
    Ok(ProviderCheck {
        ok: true,
        message: format!("{label} 服务可连接"),
        models,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesDecisionDto {
    pub intent: String,
    pub stage: String,
    pub customer_need: String,
    pub temperature: u8,
    pub commercial_risk: u8,
    pub decision_role: String,
    pub should_reply_now: bool,
    pub next_action: String,
    pub missing_facts: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReplyDto {
    pub id: String,
    pub label: String,
    pub text: String,
    pub purpose: String,
    pub risk: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAssetDto {
    pub skill: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub title: String,
    pub reason: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStrategyDto {
    pub objective: String,
    pub single_next_move: String,
    pub question: String,
    pub question_purpose: String,
    pub replies: Vec<AgentReplyDto>,
    pub asset: Option<AgentAssetDto>,
    pub follow_up: String,
    pub stop_condition: String,
    pub human_confirmation_required: bool,
    pub unsupported_claims: Vec<String>,
}

#[command]
pub async fn agent_strategy(
    text: String,
    decision: SalesDecisionDto,
    endpoint: String,
    api_key: String,
    model: String,
) -> Result<AgentStrategyDto, String> {
    let endpoint = validate_agent_endpoint(&endpoint)?;
    if text.chars().count() > 12_000 {
        return Err("本轮文本超过 12,000 字，请缩短后再分析。".into());
    }
    let loopback = reqwest::Url::parse(&endpoint)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            })
        })
        .unwrap_or(false);
    if (api_key.trim().is_empty() && !loopback) || model.trim().is_empty() {
        return Err("云端 Agent 需要 API Key；本机模型可留空 Key。请确认模型名已填写。".into());
    }
    let url = if endpoint.ends_with("/chat/completions") {
        endpoint.to_string()
    } else {
        format!("{endpoint}/chat/completions")
    };
    let schema = "返回一个 JSON object，字段严格为 objective, singleNextMove, question, questionPurpose, replies(2-3项，每项字段id,label,text,purpose,risk，risk只能是低/中/高), asset(null或对象), followUp, stopCondition, humanConfirmationRequired, unsupportedClaims。";
    let system = format!("你是销售沟通策略助手。遵守事实边界，不编造价格、折扣、交期、功效、认证、案例或承诺；以提供的本机结构化销售判断为准，不重新臆测客户意图。低置信度或商业风险>=5时必须人工确认。仅输出合法 JSON，不要 Markdown。{schema}");
    let user = serde_json::json!({"conversation_text":text,"sales_decision":decision,"instructions":"只给一个下一步动作与一个关键追问；候选回复要克制、可直接人工检查。"}).to_string();
    let mut request = http_client()?.post(url);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .json(&serde_json::json!({"model":model.trim(),"temperature":0.2,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":system},{"role":"user","content":user}]}))
        .send().await.map_err(|e| format!("Agent 请求失败：{e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Agent 返回内容不是有效 JSON。".to_string())?;
    if !status.is_success() {
        return Err(format!("Agent API 返回 {status}：{}", api_error(&payload)));
    }
    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Agent 响应缺少 message.content。".to_string())?;
    let mut result: AgentStrategyDto = serde_json::from_str(content)
        .map_err(|_| "Agent 回复不符合要求的 JSON 结构。".to_string())?;
    if !(2..=3).contains(&result.replies.len()) {
        return Err("Agent 候选回复数量不符合 2—3 条约束。".into());
    }
    if result
        .replies
        .iter()
        .any(|reply| !["低", "中", "高"].contains(&reply.risk.as_str()))
    {
        return Err("Agent 候选回复风险等级无效。".into());
    }
    if let Some(asset) = &result.asset {
        if asset.skill != "product-showcase"
            || ![
                "comparison_card",
                "product_copy",
                "social_post",
                "short_video",
            ]
            .contains(&asset.asset_type.as_str())
            || !["recommended", "queued"].contains(&asset.status.as_str())
        {
            return Err("Agent 素材任务字段不符合应用契约。".into());
        }
    }
    if decision.commercial_risk >= 5 || decision.confidence < 0.65 {
        result.human_confirmation_required = true;
    }
    Ok(result)
}

fn api_error(value: &serde_json::Value) -> String {
    value
        .get("detail")
        .or_else(|| value.get("error"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "未提供错误详情".into())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("无法初始化安全网络连接：{e}"))
}

fn validate_agent_endpoint(endpoint: &str) -> Result<String, String> {
    let endpoint = endpoint.trim().trim_end_matches('/');
    let parsed =
        reqwest::Url::parse(endpoint).map_err(|_| "Agent Endpoint URL 无效。".to_string())?;
    let loopback = parsed.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if !(parsed.scheme() == "https" || (parsed.scheme() == "http" && loopback))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Agent Endpoint 必须使用 HTTPS；仅 localhost 可使用 HTTP。".into());
    }
    Ok(endpoint.to_string())
}

#[command]
pub fn scan_wechat() -> Result<WeChatScan, String> {
    let (tx, rx) = sync_channel(1);
    let screenshot_tx = tx.clone();
    let content_handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            if content.is_null() {
                let _ = tx.send(Err(screen_capture_failure(error)));
                return;
            }

            let content = unsafe { &*content };
            let Some(candidate) = select_wechat_window(content).into_iter().next() else {
                let _ = tx.send(Err(no_wechat_window_error()));
                return;
            };

            // Recheck the owner immediately before capture; the frontend never supplies a window ID.
            let Some(owner) = (unsafe { candidate.window.owningApplication() }) else {
                let _ = tx.send(Err("微信窗口已关闭，请重试。".into()));
                return;
            };
            if !is_wechat_application(&owner) {
                let _ = tx.send(Err("目标窗口不再属于微信，已取消读取。".into()));
                return;
            }

            capture_window(candidate.window, candidate.title, screenshot_tx.clone());
        },
    );

    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&content_handler) };
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "读取微信窗口超时；你可以手动粘贴聊天内容继续。".to_string())?
}

#[command]
pub fn import_recent_wechat_customers() -> Result<WeChatCustomerImport, String> {
    let (tx, rx) = sync_channel(1);
    let screenshot_tx = tx.clone();
    let content_handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            if content.is_null() {
                let _ = tx.send(Err(screen_capture_failure(error)));
                return;
            }

            let content = unsafe { &*content };
            let Some(candidate) = select_wechat_window(content).into_iter().next() else {
                let _ = tx.send(Err(no_wechat_window_error()));
                return;
            };
            let Some(owner) = (unsafe { candidate.window.owningApplication() }) else {
                let _ = tx.send(Err("微信窗口已关闭，请重试。".into()));
                return;
            };
            if !is_wechat_application(&owner) {
                let _ = tx.send(Err("目标窗口不再属于微信，已取消读取。".into()));
                return;
            }

            capture_chat_list(candidate.window, candidate.title, screenshot_tx.clone());
        },
    );

    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&content_handler) };
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "读取微信会话列表超时，请确认微信窗口已打开后重试。".to_string())?
}

struct WeChatWindowCandidate {
    window: Retained<SCWindow>,
    title: String,
    area: f64,
    main_title: bool,
}

fn is_wechat_application(app: &SCRunningApplication) -> bool {
    let bundle_id = unsafe { app.bundleIdentifier() }.to_string();
    let app_name = unsafe { app.applicationName() }.to_string();
    bundle_id == WECHAT_BUNDLE || WECHAT_NAMES.contains(&app_name.as_str())
}

fn select_wechat_window(content: &SCShareableContent) -> Vec<WeChatWindowCandidate> {
    let windows = unsafe { content.windows() };
    let mut candidates = windows
        .iter()
        .filter_map(|window| {
            let owner = unsafe { window.owningApplication() }?;
            if !is_wechat_application(&owner) || !unsafe { window.isOnScreen() } {
                return None;
            }
            let frame = unsafe { window.frame() };
            if frame.size.width < MIN_WINDOW_WIDTH || frame.size.height < MIN_WINDOW_HEIGHT {
                return None;
            }
            let title = unsafe { window.title() }
                .map(|value| value.to_string())
                .unwrap_or_default();
            Some(WeChatWindowCandidate {
                window,
                main_title: WECHAT_NAMES.contains(&title.as_str()),
                title,
                area: frame.size.width * frame.size.height,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        b.main_title
            .cmp(&a.main_title)
            .then_with(|| b.area.total_cmp(&a.area))
    });
    candidates
}

fn capture_window(
    window: Retained<SCWindow>,
    title: String,
    tx: std::sync::mpsc::SyncSender<Result<WeChatScan, String>>,
) {
    let filter = unsafe {
        SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window)
    };
    let configuration = unsafe { SCStreamConfiguration::new() };
    let keep_filter = filter.clone();
    let keep_configuration = configuration.clone();
    let screenshot_handler = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        let _keep_native_inputs_alive = (&keep_filter, &keep_configuration);
        let result = if image.is_null() {
            Err(screen_capture_failure(error))
        } else {
            recognize_chat_text(unsafe { &*image }).and_then(|(text, conversation_title)| {
                if text.is_empty() {
                    Err(
                        "微信窗口已识别，但没有读到聊天文字。请打开具体会话，或改用手动粘贴。"
                            .into(),
                    )
                } else {
                    Ok(WeChatScan {
                        window_title: if title.is_empty() {
                            "微信聊天窗口".into()
                        } else {
                            title.clone()
                        },
                        conversation_title,
                        text,
                        status: "微信窗口已识别，OCR 文本待分析；请确认内容后再继续。".into(),
                    })
                }
            })
        };
        let _ = tx.send(result);
    });
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            &filter,
            &configuration,
            Some(&screenshot_handler),
        )
    };
}

fn capture_chat_list(
    window: Retained<SCWindow>,
    title: String,
    tx: std::sync::mpsc::SyncSender<Result<WeChatCustomerImport, String>>,
) {
    let filter = unsafe {
        SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window)
    };
    let configuration = unsafe { SCStreamConfiguration::new() };
    let keep_filter = filter.clone();
    let keep_configuration = configuration.clone();
    let screenshot_handler = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        let _keep_native_inputs_alive = (&keep_filter, &keep_configuration);
        let result = if image.is_null() {
            Err(screen_capture_failure(error))
        } else {
            recognize_chat_list(unsafe { &*image }).map(|(customers, visible_rows, skipped_groups, skipped_uncertain)| {
                let enough = customers.len() >= 20;
                Ok(WeChatCustomerImport {
                    window_title: if title.is_empty() { "微信".into() } else { title.clone() },
                    customers,
                    visible_rows,
                    skipped_group_rows: skipped_groups,
                    skipped_uncertain_rows: skipped_uncertain,
                    status: if enough {
                        "已读取微信会话列表；按名称中可识别的群聊标记过滤，最多处理前 20 个名称，未读取聊天正文。".into()
                    } else {
                        "已读取当前可见的微信会话列表；按名称中可识别的群聊标记过滤，未读取聊天正文。若少于 20 位，可滚动列表后再次导入。".into()
                    },
                })
            }).and_then(|result| result)
        };
        let _ = tx.send(result);
    });
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            &filter,
            &configuration,
            Some(&screenshot_handler),
        )
    };
}

fn recognize_chat_list(
    image: &CGImage,
) -> Result<(Vec<WeChatCustomerCandidate>, usize, usize, usize), String> {
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    let supported_languages = unsafe { request.supportedRecognitionLanguagesAndReturnError() }
        .ok()
        .map(|languages| {
            languages
                .iter()
                .map(|language| language.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let recognition_languages = ["zh-Hans", "zh-Hant", "en-US"]
        .into_iter()
        .filter(|language| supported_languages.iter().any(|item| item == language))
        .map(NSString::from_str)
        .collect::<Vec<_>>();
    if !recognition_languages.is_empty() {
        let languages = NSArray::from_retained_slice(&recognition_languages);
        request.setRecognitionLanguages(&languages);
    }
    let options: Retained<NSDictionary<VNImageOption, AnyObject>> =
        NSDictionary::from_slices::<NSString>(&[], &[]);
    let handler = unsafe {
        VNImageRequestHandler::initWithCGImage_options(
            VNImageRequestHandler::alloc(),
            image,
            &options,
        )
    };
    let base_request: Retained<VNRequest> = request.clone().into_super().into_super();
    let requests = NSArray::from_retained_slice(&[base_request]);
    handler
        .performRequests_error(&requests)
        .map_err(|_| "微信会话列表 OCR 失败，请确认窗口清晰可见后重试。".to_string())?;

    let observations = request
        .results()
        .ok_or_else(|| "微信会话列表 OCR 失败，请确认窗口清晰可见后重试。".to_string())?;
    let lines = observations
        .iter()
        .filter_map(|observation| {
            let candidate = observation.topCandidates(1).iter().next()?;
            let bounds = unsafe { observation.boundingBox() };
            let text = candidate.string().to_string().trim().to_string();
            // The leftmost 28% is the WeChat conversation list. Do not retain or
            // return OCR from the open conversation pane.
            (bounds.origin.x >= 0.04
                && bounds.origin.x <= 0.28
                && bounds.origin.y >= 0.06
                && bounds.origin.y <= 0.90
                && candidate.confidence() >= 0.45
                && !text.is_empty())
            .then_some((
                bounds.origin.y + bounds.size.height / 2.0,
                bounds.origin.x,
                candidate.confidence(),
                text,
            ))
        })
        .collect::<Vec<_>>();
    let (customers, visible_rows, skipped_groups, skipped_uncertain) =
        extract_chat_list_customers(lines);
    Ok((customers, visible_rows, skipped_groups, skipped_uncertain))
}

fn extract_chat_list_customers(
    mut lines: Vec<(f64, f64, f32, String)>,
) -> (Vec<WeChatCustomerCandidate>, usize, usize, usize) {
    lines.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.total_cmp(&b.1)));
    let mut rows: Vec<Vec<(f64, f64, f32, String)>> = Vec::new();
    for line in lines {
        if let Some(row) = rows.last_mut() {
            let highest_y = row.iter().map(|item| item.0).fold(f64::MIN, f64::max);
            if highest_y - line.0 <= 0.043 {
                row.push(line);
                continue;
            }
        }
        rows.push(vec![line]);
    }

    let visible_rows = rows.len();
    let mut customers = Vec::new();
    let mut skipped_groups = 0;
    let mut skipped_uncertain = 0;
    let mut seen = std::collections::HashSet::new();
    const NON_CONTACT_ROWS: [&str; 9] = [
        "微信",
        "wechat",
        "weixin",
        "搜索",
        "文件传输助手",
        "服务通知",
        "微信团队",
        "订阅号",
        "企业微信",
    ];

    for mut row in rows {
        row.sort_by(|a, b| b.0.total_cmp(&a.0));
        let Some((_, _, confidence, name)) = row.first() else {
            skipped_uncertain += 1;
            continue;
        };
        let name = name.trim();
        let normalized = name.to_lowercase().replace(char::is_whitespace, "");
        let char_count = name.chars().count();
        if NON_CONTACT_ROWS.iter().any(|item| normalized == *item)
            || char_count == 0
            || char_count > 18
            || name.chars().all(|character| character.is_ascii_digit())
            || name
                .chars()
                .any(|character| ['。', '！', '？', '…', '\n'].contains(&character))
            || name.ends_with("...")
            || *confidence < 0.62
        {
            skipped_uncertain += 1;
            continue;
        }
        if is_group_chat_name(name) {
            skipped_groups += 1;
            continue;
        }
        if seen.insert(normalized) {
            customers.push(WeChatCustomerCandidate {
                name: name.to_string(),
            });
        }
        if customers.len() == 20 {
            break;
        }
    }

    (customers, visible_rows, skipped_groups, skipped_uncertain)
}

fn is_group_chat_name(name: &str) -> bool {
    let normalized = name.to_lowercase();
    ["群", "@chatroom", "chatroom", "多人聊天", "群组"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn recognize_chat_text(image: &CGImage) -> Result<(String, Option<String>), String> {
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    let supported_languages = unsafe { request.supportedRecognitionLanguagesAndReturnError() }
        .ok()
        .map(|languages| {
            languages
                .iter()
                .map(|language| language.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let recognition_languages = ["zh-Hans", "zh-Hant", "en-US"]
        .into_iter()
        .filter(|language| supported_languages.iter().any(|item| item == language))
        .map(NSString::from_str)
        .collect::<Vec<_>>();
    if !recognition_languages.is_empty() {
        let languages = NSArray::from_retained_slice(&recognition_languages);
        request.setRecognitionLanguages(&languages);
    }
    let options: Retained<NSDictionary<VNImageOption, AnyObject>> =
        NSDictionary::from_slices::<NSString>(&[], &[]);
    let handler = unsafe {
        VNImageRequestHandler::initWithCGImage_options(
            VNImageRequestHandler::alloc(),
            image,
            &options,
        )
    };
    let base_request: Retained<VNRequest> = request.clone().into_super().into_super();
    let requests = NSArray::from_retained_slice(&[base_request]);
    handler
        .performRequests_error(&requests)
        .map_err(|_| "微信画面 OCR 失败；你可以手动粘贴聊天内容继续。".to_string())?;

    let observations = request
        .results()
        .ok_or_else(|| "微信画面 OCR 失败；你可以手动粘贴聊天内容继续。".to_string())?;
    let mut lines = observations
        .iter()
        .filter_map(|observation| {
            let candidates = observation.topCandidates(1);
            let candidate = candidates.iter().next()?;
            let bounds = unsafe { observation.boundingBox() };
            let text = candidate.string().to_string().trim().to_string();
            (bounds.origin.x >= 0.30
                && bounds.origin.y >= 0.08
                && bounds.origin.y <= 0.98
                && candidate.confidence() >= 0.30
                && !text.is_empty())
            .then_some((bounds.origin.y, bounds.origin.x, text))
        })
        .collect::<Vec<_>>();
    lines.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.total_cmp(&b.1)));
    let conversation_title = extract_conversation_title(&lines);
    let text = lines
        .into_iter()
        .map(|(_, _, text)| text)
        .collect::<Vec<_>>()
        .join("\n");
    Ok((text, conversation_title))
}

fn extract_conversation_title(lines: &[(f64, f64, String)]) -> Option<String> {
    let generic_titles = [
        "微信",
        "wechat",
        "weixin",
        "聊天",
        "通讯录",
        "文件传输助手",
        "聊天信息",
    ];
    lines
        .iter()
        .filter(|(y, x, candidate)| {
            let candidate = candidate.trim();
            let normalized = candidate.to_lowercase();
            *y >= 0.84
                && *y <= 0.98
                && *x >= 0.18
                && *x <= 0.78
                && (2..=32).contains(&candidate.chars().count())
                && !generic_titles.iter().any(|title| normalized == *title)
                && !candidate
                    .chars()
                    .all(|character| character.is_ascii_digit())
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, _, candidate)| candidate.trim().to_string())
}

fn screen_capture_failure(error: *mut NSError) -> String {
    let system_code = if error.is_null() {
        String::from("无错误码")
    } else {
        unsafe { (&*error).code().to_string() }
    };
    format!(
        "ScreenCaptureKit 无法读取微信窗口（系统错误 {system_code}）。请确认本应用的屏幕录制权限已开启，并重启 App 后重试。"
    )
}

fn no_wechat_window_error() -> String {
    "没有找到已打开的微信主聊天窗口。请打开微信并进入客户聊天后重试；也可手动粘贴聊天内容。".into()
}

fn with_shareable_content<T: Send + 'static>(
    callback: impl FnOnce(&SCShareableContent) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = sync_channel(1);
    let callback = Mutex::new(Some(callback));
    let content_handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if content.is_null() {
                Err(screen_capture_failure(error))
            } else {
                let callback = callback
                    .lock()
                    .ok()
                    .and_then(|mut callback| callback.take());
                match callback {
                    Some(callback) => callback(unsafe { &*content }),
                    None => Err("读取微信窗口状态失败，请重试。".into()),
                }
            };
            let _ = tx.send(result);
        },
    );
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&content_handler) };
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| "读取微信窗口超时，请重试。".to_string())?
}

#[command]
pub fn fill_wechat_input(text: String) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有可回填的回复内容。".into());
    }
    if text.len() > 8_000 {
        return Err("回复内容过长，未写入微信输入框。".into());
    }
    if !unsafe { accessibility_sys::AXIsProcessTrusted() } {
        return Err(
            "尚未授予辅助功能权限。请在系统设置中授权后重试；也可使用复制粘贴兜底。".into(),
        );
    }

    let (frame, pid) = with_shareable_content(|content| {
        let candidate = select_wechat_window(content)
            .into_iter()
            .next()
            .ok_or_else(|| "没有找到微信聊天窗口，未回填内容。".to_string())?;
        let owner = unsafe { candidate.window.owningApplication() }
            .ok_or_else(|| "微信窗口已关闭，未回填内容。".to_string())?;
        if !is_wechat_application(&owner) {
            return Err("目标窗口已不是微信，未回填内容。".into());
        }
        let frame = unsafe { candidate.window.frame() };
        let pid = unsafe { owner.processID() };
        Ok((frame, pid))
    })?;
    let root = unsafe { accessibility_sys::AXUIElementCreateApplication(pid) };
    if root.is_null() {
        return Err("无法访问微信辅助功能树。".into());
    }
    let bounds = (
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height,
    );
    let input = find_largest_text_area(root, bounds)?;
    if input.is_null() {
        return Err("未找到微信聊天输入框，未回填内容。可改用复制粘贴。".into());
    }

    let value_key = cf_string("AXValue")?;
    let current = copy_attribute(input, value_key)?;
    let existing = cf_string_value(current as _);
    // Replace only a truly empty composer. Never silently overwrite text the user typed.
    if !existing.trim().is_empty() {
        unsafe {
            core_foundation_sys::base::CFRelease(current);
            core_foundation_sys::base::CFRelease(value_key as _);
            core_foundation_sys::base::CFRelease(input as _);
            core_foundation_sys::base::CFRelease(root as _);
        }
        return Err(
            "微信输入框已有内容，为避免覆盖草稿，未自动回填。请先检查或使用复制粘贴。".into(),
        );
    }
    unsafe {
        core_foundation_sys::base::CFRelease(current);
    }
    let replacement = cf_string(text)?;
    let result = unsafe {
        accessibility_sys::AXUIElementSetAttributeValue(input, value_key, replacement as _)
    };
    unsafe {
        core_foundation_sys::base::CFRelease(replacement as _);
    }
    if result != 0 {
        unsafe {
            core_foundation_sys::base::CFRelease(value_key as _);
            core_foundation_sys::base::CFRelease(input as _);
            core_foundation_sys::base::CFRelease(root as _);
        }
        return Err("微信拒绝了输入框写入；未发送任何消息，可手动粘贴。".into());
    }
    let landed = copy_attribute(input, value_key).ok().map(|value| {
        let text = cf_string_value(value as _);
        unsafe {
            core_foundation_sys::base::CFRelease(value);
        }
        text
    });
    unsafe {
        core_foundation_sys::base::CFRelease(value_key as _);
        core_foundation_sys::base::CFRelease(input as _);
        core_foundation_sys::base::CFRelease(root as _);
    }
    if landed.as_deref() != Some(text) {
        return Err(
            "写入后未能从微信输入框回读到完整内容；未发送任何消息，可改用手动粘贴。".into(),
        );
    }
    Ok("建议回复已回填到微信输入框，尚未发送。请检查后由你手动发送。".into())
}

fn find_largest_text_area(
    root: accessibility_sys::AXUIElementRef,
    bounds: (f64, f64, f64, f64),
) -> Result<accessibility_sys::AXUIElementRef, String> {
    let children_key = cf_string("AXChildren")?;
    let role_key = cf_string("AXRole")?;
    let size_key = cf_string("AXSize")?;
    let position_key = cf_string("AXPosition")?;
    let mut queue = VecDeque::from([root]);
    let mut seen = 0usize;
    let mut best: accessibility_sys::AXUIElementRef = std::ptr::null_mut();
    let mut best_area = 10_000.0f64;
    while let Some(element) = queue.pop_front() {
        seen += 1;
        if seen > 2_000 {
            break;
        }
        if let Ok(role) = copy_attribute(element, role_key) {
            let is_text_area = cf_string_equals(role, "AXTextArea");
            unsafe {
                core_foundation_sys::base::CFRelease(role);
            }
            if is_text_area {
                if let Ok(size) = copy_attribute(element, size_key) {
                    let mut dimensions = AXSize {
                        width: 0.0,
                        height: 0.0,
                    };
                    let valid = unsafe {
                        accessibility_sys::AXValueGetType(size as _)
                            == accessibility_sys::kAXValueTypeCGSize
                            && accessibility_sys::AXValueGetValue(
                                size as _,
                                accessibility_sys::kAXValueTypeCGSize,
                                (&mut dimensions as *mut AXSize).cast(),
                            )
                    };
                    let position = copy_attribute(element, position_key);
                    let mut point = AXPoint { x: 0.0, y: 0.0 };
                    let positioned = position.as_ref().is_ok_and(|value| unsafe {
                        accessibility_sys::AXValueGetType(*value as _)
                            == accessibility_sys::kAXValueTypeCGPoint
                            && accessibility_sys::AXValueGetValue(
                                *value as _,
                                accessibility_sys::kAXValueTypeCGPoint,
                                (&mut point as *mut AXPoint).cast(),
                            )
                    });
                    if let Ok(position) = position {
                        unsafe {
                            core_foundation_sys::base::CFRelease(position);
                        }
                    }
                    let (wx, wy, ww, wh) = bounds;
                    let inside_target = positioned
                        && point.x >= wx
                        && point.y >= wy
                        && point.x + dimensions.width <= wx + ww + 3.0
                        && point.y + dimensions.height <= wy + wh + 3.0;
                    let area = if valid && inside_target {
                        dimensions.width * dimensions.height
                    } else {
                        0.0
                    };
                    if area > best_area {
                        if !best.is_null() {
                            unsafe {
                                core_foundation_sys::base::CFRelease(best as _);
                            }
                        }
                        best = element;
                        unsafe {
                            core_foundation_sys::base::CFRetain(best as _);
                        }
                        best_area = area;
                    }
                    unsafe {
                        core_foundation_sys::base::CFRelease(size);
                    }
                }
            }
        }
        if let Ok(children) = copy_attribute(element, children_key) {
            let count =
                unsafe { core_foundation_sys::array::CFArrayGetCount(children as _) }.max(0);
            for index in 0..count.min(2_000) {
                let child = unsafe {
                    core_foundation_sys::array::CFArrayGetValueAtIndex(children as _, index)
                } as accessibility_sys::AXUIElementRef;
                if !child.is_null() {
                    unsafe {
                        core_foundation_sys::base::CFRetain(child as _);
                    }
                    queue.push_back(child);
                }
            }
            unsafe {
                core_foundation_sys::base::CFRelease(children);
            }
        }
        if element != root {
            unsafe {
                core_foundation_sys::base::CFRelease(element as _);
            }
        }
    }
    unsafe {
        core_foundation_sys::base::CFRelease(children_key as _);
        core_foundation_sys::base::CFRelease(role_key as _);
        core_foundation_sys::base::CFRelease(size_key as _);
        core_foundation_sys::base::CFRelease(position_key as _);
    }
    if !root.is_null() {
        unsafe {
            core_foundation_sys::base::CFRelease(root as _);
        }
    }
    if best.is_null() {
        Err("未定位到微信聊天输入框。".into())
    } else {
        Ok(best)
    }
}

fn cf_string(value: &str) -> Result<core_foundation_sys::string::CFStringRef, String> {
    let value = CString::new(value).map_err(|_| "文本包含无效字符。".to_string())?;
    Ok(unsafe {
        core_foundation_sys::string::CFStringCreateWithCString(
            std::ptr::null(),
            value.as_ptr(),
            core_foundation_sys::string::kCFStringEncodingUTF8,
        )
    })
}

fn copy_attribute(
    element: accessibility_sys::AXUIElementRef,
    key: core_foundation_sys::string::CFStringRef,
) -> Result<core_foundation_sys::base::CFTypeRef, String> {
    let mut value = std::ptr::null();
    let status =
        unsafe { accessibility_sys::AXUIElementCopyAttributeValue(element, key, &mut value) };
    if status == 0 && !value.is_null() {
        Ok(value)
    } else {
        Err("无法读取微信辅助功能属性。".into())
    }
}

fn cf_string_equals(value: core_foundation_sys::base::CFTypeRef, expected: &str) -> bool {
    let expected = match cf_string(expected) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let same = unsafe {
        core_foundation_sys::string::CFStringCompare(value as _, expected, 0)
            == core_foundation_sys::base::CFComparisonResult::EqualTo
    };
    unsafe {
        core_foundation_sys::base::CFRelease(expected as _);
    }
    same
}

fn cf_string_value(value: core_foundation_sys::string::CFStringRef) -> String {
    let capacity = unsafe {
        core_foundation_sys::string::CFStringGetMaximumSizeForEncoding(
            core_foundation_sys::string::CFStringGetLength(value),
            core_foundation_sys::string::kCFStringEncodingUTF8,
        )
    } as usize
        + 1;
    let mut bytes = vec![0i8; capacity.max(1)];
    let converted = unsafe {
        core_foundation_sys::string::CFStringGetCString(
            value,
            bytes.as_mut_ptr(),
            bytes.len() as _,
            core_foundation_sys::string::kCFStringEncodingUTF8,
        )
    };
    if converted == 0 {
        String::new()
    } else {
        unsafe {
            std::ffi::CStr::from_ptr(bytes.as_ptr())
                .to_string_lossy()
                .into_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_policy_requires_https_except_loopback() {
        assert!(validate_agent_endpoint("https://api.example.com/v1").is_ok());
        assert!(validate_agent_endpoint("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_agent_endpoint("http://localhost:8000/v1").is_ok());
        assert!(validate_agent_endpoint("http://localhost.attacker.test/v1").is_err());
        assert!(validate_agent_endpoint("https://user:pass@example.com/v1").is_err());
        assert!(validate_agent_endpoint("https://api.example.com/v1?token=secret").is_err());
    }

    #[test]
    fn bocha_query_is_trimmed_and_bounded_without_logging_or_transcript_context() {
        assert_eq!(
            validate_bocha_query("  官方续航参数  ").unwrap(),
            "官方续航参数"
        );
        assert!(validate_bocha_query("   ").is_err());
        assert!(validate_bocha_query(&"x".repeat(201)).is_err());
    }

    #[test]
    fn bocha_results_parse_public_web_fields_and_reject_non_https_urls() {
        let payload = serde_json::json!({"webPages":{"value":[
            {"name":"官方规格","url":"https://example.com/spec","siteName":"官网","snippet":"参数摘要","summary":"官方页面说明","datePublished":"2026-09-01"},
            {"name":"不安全链接","url":"http://example.com/"}
        ]}});
        let results = parse_bocha_search_results(&payload).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "官方规格");
        assert_eq!(results[0].summary, "官方页面说明");
        assert_eq!(results[0].published_date.as_deref(), Some("2026-09-01"));
        assert!(parse_bocha_search_results(&serde_json::json!({})).is_err());
    }

    #[test]
    fn agent_reply_contract_deserializes_expected_shape() {
        let reply: AgentReplyDto = serde_json::from_value(serde_json::json!({
            "id":"r1", "label":"先确认", "text":"我先核实后回复", "purpose":"补齐事实", "risk":"低"
        }))
        .unwrap();
        assert_eq!(reply.risk, "低");
        assert!(!["低", "中", "高"].contains(&"未知"));
    }

    #[test]
    fn conversation_title_uses_only_the_wechat_header_region() {
        let lines = vec![
            (0.96, 0.22, "微信".to_string()),
            (0.91, 0.32, "林然".to_string()),
            (0.73, 0.42, "这款手机拍照怎么样".to_string()),
            (0.94, 0.04, "微信".to_string()),
        ];
        assert_eq!(extract_conversation_title(&lines).as_deref(), Some("林然"));
        assert_eq!(
            extract_conversation_title(&[(0.93, 0.34, "微信".to_string())]),
            None
        );
    }

    #[test]
    fn chat_list_import_uses_row_titles_and_excludes_marked_groups() {
        let lines = vec![
            (0.88, 0.08, 0.92, "林然".to_string()),
            (0.85, 0.08, 0.91, "这款什么时候到货".to_string()),
            (0.77, 0.08, 0.96, "摄影交流群".to_string()),
            (0.74, 0.08, 0.93, "周末一起拍照".to_string()),
            (0.66, 0.08, 0.54, "陈".to_string()),
            (0.58, 0.08, 0.92, "陈小满".to_string()),
        ];
        let (customers, visible, groups, uncertain) = extract_chat_list_customers(lines);
        assert_eq!(visible, 4);
        assert_eq!(
            customers
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["林然", "陈小满"]
        );
        assert_eq!(groups, 1);
        assert_eq!(uncertain, 1);
    }

    #[test]
    fn chat_list_import_deduplicates_and_caps_at_twenty() {
        let mut lines = Vec::new();
        for index in 0..24 {
            let y = 0.89 - f64::from(index) * 0.05;
            lines.push((y, 0.08, 0.95, format!("客户{index}")));
        }
        lines.push((0.03, 0.08, 0.95, "客户0".to_string()));
        let (customers, _, _, _) = extract_chat_list_customers(lines);
        assert_eq!(customers.len(), 20);
        assert_eq!(customers[0].name, "客户0");
    }
}
