use futures_util::SinkExt; 
use log::{info, error}; 
use tokio::net::TcpStream;
use tokio_tungstenite::{client_async, tungstenite::{protocol::Message, client::IntoClientRequest}, MaybeTlsStream, WebSocketStream};
use tokio::time::{sleep, Duration};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use url::Url;
use native_tls::TlsConnector;
use tokio_native_tls::TlsConnector as TokioTlsConnector;

pub struct WebSocketManager {
    url: String,
    token: String,
    session_id: String,
    tx: Arc<Mutex<Option<WebSocketStream<MaybeTlsStream<TcpStream>>>>>,
    notify: Arc<Notify>,
}

impl WebSocketManager {
    pub fn new(url: String, token: String, session_id: String) -> Self {
        Self {
            url,
            token,
            session_id,

            tx: Arc::new(Mutex::new(None)),
            notify: Arc::new(Notify::new()),
        }
    }

    pub async fn connect_loop(&self) {
        let reconnect_interval = Duration::from_secs(2);

        loop {
            info!("Connecting to streaming server: {}", self.url);

            let uri_str = format!("{}?session={}", self.url, self.session_id);
            let url_parsed = Url::parse(&uri_str).expect("Invalid URL");
            
            let host = url_parsed.host_str().unwrap();
            let port = url_parsed.port_or_known_default().unwrap();
            let addr = format!("{}:{}", host, port);

            match TcpStream::connect(&addr).await {
                Ok(stream) => {
                    stream.set_nodelay(true).expect("Failed to set TCP_NODELAY");

                    let mut request = uri_str.clone().into_client_request().unwrap();
                    let headers = request.headers_mut();
                    headers.insert("Authorization", format!("Bearer {}", self.token).parse().unwrap());
                    headers.insert("Session-Id", self.session_id.parse().unwrap());

                    let ws_stream_result = if url_parsed.scheme() == "wss" {
                        // Secure WSS with Nodelay
                        let cx = TlsConnector::builder().build().unwrap();
                        let cx = TokioTlsConnector::from(cx);
                        
                        match cx.connect(host, stream).await {
                            Ok(tls_stream) => {
                                let stream = MaybeTlsStream::NativeTls(tls_stream);
                                client_async(request, stream).await
                            },
                            Err(e) => {
                                error!("TLS Handshake failed: {}", e);
                                sleep(reconnect_interval).await;
                                continue;
                            }
                        }
                    } else {
                        // Plain WS with Nodelay
                        let stream = MaybeTlsStream::Plain(stream);
                        client_async(request, stream).await
                    };

                    match ws_stream_result {
                        Ok((ws_stream, _)) => {
                            info!("WebSocket connected! (TCP_NODELAY=true, Scheme: {})", url_parsed.scheme());
                            let mut lock = self.tx.lock().await;
                            *lock = Some(ws_stream);
                            drop(lock);
                            self.notify.notify_waiters();
                            self.read_loop().await;
                            info!("WebSocket disconnected. Reconnecting...");
                        },
                        Err(e) => error!("WebSocket handshake error: {}", e),
                    }
                },
                Err(e) => error!("TCP Connect error: {}", e),
            }

            sleep(reconnect_interval).await;
        }
    }

    async fn read_loop(&self) {
        loop {
            sleep(Duration::from_secs(1)).await;
            let lock = self.tx.lock().await; 
            if lock.is_none() { break; }
        }
    }

    pub async fn send_data(&self, data: Vec<u8>) -> Result<(), String> {
        let mut lock = self.tx.lock().await;
        if let Some(stream) = lock.as_mut() {
            stream.send(Message::Binary(data)).await.map_err(|e| e.to_string())
        } else {
            Err("Not connected".to_string())
        }
    }

    pub async fn wait_for_connection(&self) {
        if self.tx.lock().await.is_some() {
            return;
        }
        self.notify.notified().await;
    }
}