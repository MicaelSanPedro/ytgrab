# 🖥️ Servidor do YTGrab Web (grátis, ~10 min)

O site (`site/`) funciona sozinho com instâncias públicas, mas elas são
instáveis (o YouTube vive bloqueando IPs de datacenter). Para o site ser
**100% confiável sem o visitante configurar nada**, o projeto mantém um
servidor Cobalt próprio — grátis no Render.

Quem visita o site não vê nada disso: o `servers.json` (na raiz do branch
`gh-pages`) é lido automaticamente e o servidor do projeto vira a 1ª opção.

---

## Opção A — Render (mais fácil)

1. Crie conta grátis em [render.com](https://render.com) (login com GitHub).
2. Crie um repositório público só com o arquivo `docker-compose.yml` desta
   pasta (ou use qualquer repo que o contenha).
3. **New → Web Service**:
   - Conecte o repositório
   - **Runtime**: Docker
   - **Root Directory**: o caminho onde está o `docker-compose.yml`
4. Em **Environment**:
   - `API_URL` = `https://ytgrab-servidor.onrender.com/` (o nome que você
     escolheu, **com barra no final**)
   - `API_PORT` = `9000`
5. **Plano Free** → Create Web Service. Aguarde ~2 min o primeiro deploy.
6. Teste no navegador: abra `https://ytgrab-servidor.onrender.com/` — deve
   responder um JSON da API. (O plano free adormece sem uso; a 1ª requisição
   pode demorar ~50 s para acordar. O site já sabe disso e tenta 2 vezes.)

## Registrar o servidor no site

Edite **`servers.json` na raiz do branch `gh-pages`** (direto no GitHub):

```json
{
  "primary": [
    { "engine": "cobalt", "base": "https://ytgrab-servidor.onrender.com" }
  ]
}
```

Pronto — o site passa a usá-lo como 1ª opção, com fallback automático para
as instâncias públicas. Sem redeploy.

## Opção B — Oracle Cloud Always Free (avançado, melhor)

VM grátis **para sempre** (4 OCPU ARM / 24 GB) que não adormece. Além disso,
dá para girar IPv6 a cada requisição — o truque que as instâncias grandes
usam para o YouTube não bloquear:

1. Crie a VM (Ubuntu 22.04+, imagem com suporte a IPv6 /64).
2. Instale Docker + compose e rode o `docker-compose.yml` desta pasta com
   `API_URL=https://seu-dominio/`.
3. Coloque um reverse proxy com TLS (Caddy é o mais simples) na frente.
4. (Opcional) Ative a rotação de IPv6 documentada pelo Cobalt/Invidious.

## Por que não dá pra fazer "sem servidor nenhum"?

Resumo da pesquisa (set/2026):

| Método | Status |
|---|---|
| Navegador → YouTube direto | ❌ impossível (CORS + anti-bot) |
| Invidious público (API) | ❌ as 5 instâncias oficiais **desativaram a API pública** (registro oficial: cors ❌ api ❌) |
| Piped público | ⚠️ só responde vídeos **em cache**; vídeos novos = "YouTube probably temporarily blocked" |
| Cobalt público | ❌ todos exigem JWT + Cloudflare Turnstile (impossível cross-origin) |
| InnerTube direto do navegador | ❌ 403 + sem CORS |
| **Servidor próprio (este guia)** | ✅ anônimo, CORS aberto, confiável |
