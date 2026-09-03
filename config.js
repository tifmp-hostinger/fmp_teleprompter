// Configuração de runtime do FMP Teleprompter.
// Em Docker este arquivo é regravado na inicialização do contêiner a partir das
// variáveis de ambiente (PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE, PEER_KEY).
// Fora do Docker, edite aqui se quiser usar um servidor PeerJS próprio:
//   window.FMP_CONFIG = { peer: { host: 'peer.seudominio.com', port: 443, path: '/', secure: true } };
window.FMP_CONFIG = { peer: null };
