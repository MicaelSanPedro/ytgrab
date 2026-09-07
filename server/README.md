# Servidor do YTGrab (Cobalt no Render) — passo a passo

O app no celular **não baixa do YouTube diretamente**: ele conversa com esta
instância do [Cobalt](https://github.com/imputnet/cobalt) (open source), que
resolve o link do vídeo e devolve o arquivo. Tudo roda no plano **grátis** do
[Render](https://render.com) — sem cartão.

Este guia é pra **você** (dono da conta Render), não pra nenhum agente.
~10 minutos.

---

## 1. Criar a conta no Render (se ainda não tiver)

1. Abra https://render.com
2. Clique em **Sign Up** e entre com sua conta do **GitHub** (a mesma
   `MicaelSanPedro`).
3. Não precisa cadastrar cartão — plano free.

## 2. Criar o serviço

1. Clique em **New** → **Web Service**.
2. Em "Connect Repository", procure e selecione **`MicaelSanPedro/ytgrab`**
   (o repositório precisa estar **público** — já está).
3. Configure:
   - **Name**: `ytgrab-servidor` (esse nome vira o domínio; pode mudar,
     mas anote qual usou — o domínio final é `https://SEU-NOME.onrender.com`)
   - **Region**: onde estiver mais perto (ex.: *Ohio* ou *Frankfurt*)
   - **Runtime**: **Docker** (o Render detecta pelo Dockerfile)
   - **Root Directory**: `server`  ← importante! (sem aspas)
   - **Plan**: **Free**
4. Em **Environment** (mesma tela de criação, role a página), adicione:
   - `API_URL`  = `https://ytgrab-servidor.onrender.com/`  (seu nome + **barra no final**)
   - `API_PORT` = `9000`
5. Clique em **Create Web Service** e aguarde o primeiro deploy (~1–3 min,
   o Render puxa a imagem do Cobalt).

## 3. Testar (no PC, no navegador)

1. Abra `https://SEU-NOME.onrender.com/` no navegador do **PC**.
   - ✅ Se aparecer um **JSON** com informações da API → o servidor está no ar.
   - ⚠️ Se der erro/timeout: é normal na 1ª vez (a máquina "acorda" do
     sleep do plano free). **Aguarde ~60s e recarregue.**
2. Com a página aberta, abra o DevTools (**F12**) → aba **Console** e cole:

   ```js
   fetch("https://SEU-NOME.onrender.com/", {
     method: "POST",
     headers: { "Accept": "application/json", "Content-Type": "application/json" },
     body: JSON.stringify({
       url: "https://www.youtube.com/watch?v=dQw4w9wgccc",
       downloadMode: "audio",
       audioFormat: "mp3",
       audioBitrate: "128"
     })
   })
   .then(r =&gt; r.json())
   .then(j =&gt; console.log(JSON.stringify(j, null, 2)))
   .catch(e =&gt; console.error("ERRO:", e));
   ```

   (troque `SEU-NOME` pela sua URL, nos dois lugares)

3. Resultados possíveis:
   - ✅ `{"status": "redirect", "url": "https://...googlevideo.com/...", "filename": "...mp3"}`
     → **perfeito**. Copie o `url` do resultado e cole numa nova aba do
     navegador: o MP3 deve baixar. Isso é exatamente o que o app vai fazer.
   - ✅ `{"status": "tunnel", ...}` → também funciona (o arquivo passa pelo
     servidor em vez de vir direto do YouTube).
   - ⚠️ `{"status": "error", "error": {"code": "youtube.potential_bot_detection"...}}`
     → o YouTube bloqueou o IP do Render **temporariamente**. Aguarde ~10
     min e teste de novo. Se acontecer repetidamente, me avise.
   - ❌ Outro erro → me mande uma captura de tela com o JSON.

## 4. Pronto — me avise

Me envie:
1. a **URL** do seu serviço (`https://.....onrender.com`);
2. o **status** que o teste retornou (`redirect`, `tunnel` ou o erro).

Com isso o app v2.0.0 é finalizado apontando pro seu servidor.

---

## Manutenção (quando o YouTube mudar algo, ~1x por mês)

O app/CI não se mexe: só o servidor precisa se atualizar.

1. No painel do Render, abra o serviço.
2. Aba **Deploy** → botão **Manual Deploy** → **Clear Cache and Deploy**
   (isso re-puxa a imagem `:latest` do Cobalt, com os fixes mais recentes).
3. Espere ~1 min e rode o teste da seção 3 de novo.

## Notas

- **Sleep do plano free**: o serviço dorme após ~15 min sem uso. O primeiro
  acesso "acorda" a máquina em 30–60s — o app já trata isso (mostra
  "acordando o servidor...").
- **Timeout de 100s** no plano free: quando o Cobalt devolve `redirect`
  (caso normal), o celular baixa direto do YouTube e o limite não importa.
  Em `tunnel` (raro), arquivos muito longos podem ser cortados — tente de
  novo ou troque a qualidade.
- **Privacidade**: a instância não exige login. Como é pessoal, é aceitável,
  mas a URL não deve ser divulgada (qualquer pessoa com ela pode usar para
  baixar; tem limite de 20 pedidos/minuto por IP). Se um dia quiser, dá para
  adicionar um API key no app + no Render (`API_AUTH_REQUIRED`/`API_KEY_URL`).
- **Nunca** rode `ghcr.io/imputnet/cobalt` sem definir `API_URL` — os túneis
  não funcionam sem ela.
