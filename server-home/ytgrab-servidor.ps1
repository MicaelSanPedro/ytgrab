# ============================================================
#  YTGrab — Servidor de Casa (Windows)
#  Usa o SEU IP de casa (o YouTube nunca bloqueia) e publica o
#  site automaticamente via túnel gratuito da Cloudflare.
#
#  Como usar: dê dois cliques em Iniciar-Servidor.bat
#  (na 1ª vez ele baixa yt-dlp.exe e cloudflared.exe sozinho)
# ============================================================
$ErrorActionPreference = 'Stop'
$PORT   = 8901
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$YTDLP  = Join-Path $dir 'yt-dlp.exe'
$CF     = Join-Path $dir 'cloudflared.exe'
$TOKENF = Join-Path $dir 'token.txt'
$CFLOG  = Join-Path $dir 'cf.log'
$GIST   = 'https://api.github.com/gists/cef471a101827f323dd1ad026a94b1fd'

Write-Host "=== YTGrab Servidor de Casa ===" -ForegroundColor Cyan

# ---------- 1) dependências (baixa só na 1ª vez) ----------
if (!(Test-Path $YTDLP)) {
    Write-Host "Baixando yt-dlp.exe (1ª vez)..."
    Invoke-WebRequest -UseBasicParsing 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $YTDLP
}
if (!(Test-Path $CF)) {
    Write-Host "Baixando cloudflared.exe (1ª vez)..."
    Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $CF
}

# ---------- 2) túnel público gratuito ----------
Write-Host "Abrindo túnel público..."
Remove-Item $CFLOG -ErrorAction SilentlyContinue
$cfproc = Start-Process -FilePath $CF -ArgumentList @('tunnel','--no-autoupdate','--url',"http://localhost:$PORT") `
            -RedirectStandardError $CFLOG -PassThru -NoNewWindow
$tunel = $null
for ($i = 0; $i -lt 45 -and !$tunel; $i++) {
    Start-Sleep 2
    $log = Get-Content $CFLOG -Raw -ErrorAction SilentlyContinue
    if ($log -match '(https://[a-z0-9-]+\.trycloudflare\.com)') { $tunel = $Matches[1] }
}
if (!$tunel) { Write-Host "ERRO: o túnel não subiu. Verifique sua internet." -ForegroundColor Red; Read-Host; exit 1 }
Write-Host "TÚNEL NO AR: $tunel" -ForegroundColor Green

# ---------- 3) avisa o site (gist) ----------
if (Test-Path $TOKENF) {
    $token = (Get-Content $TOKENF -Raw).Trim()
    $conteudo = '{"primary":[{"engine":"cobalt","base":"' + $tunel + '"}]}'
    $body = (@{ files = @{ 'ytgrab-home.json' = @{ content = $conteudo } } } | ConvertTo-Json -Depth 5)
    try {
        Invoke-RestMethod -Method Patch -Uri $GIST `
            -Headers @{ Authorization = "token $token"; Accept = 'application/vnd.github+json' } `
            -Body $body -ContentType 'application/json' | Out-Null
        Write-Host "Site avisado: seu PC agora é o servidor nº 1!" -ForegroundColor Green
    } catch {
        Write-Host "Aviso: não consegui atualizar o gist (confira o token.txt)." -ForegroundColor Yellow
    }
} else {
    Write-Host "Sem token.txt: o túnel funciona, mas o site não fica sabendo sozinho." -ForegroundColor Yellow
    Write-Host "Cole seu token do GitHub num arquivo chamado token.txt ao lado deste script." -ForegroundColor Yellow
}

# ---------- 4) servidor HTTP (fala a língua do Cobalt) ----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$PORT/")
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")
$listener.Start()
Write-Host "Servidor ouvindo na porta $PORT — pode deixar esta janela aberta." -ForegroundColor Cyan

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response
    $resp.Headers.Add('Access-Control-Allow-Origin', '*')
    $resp.Headers.Add('Access-Control-Allow-Headers', 'Content-Type,Accept')
    if ($req.HttpMethod -eq 'OPTIONS') { $resp.StatusCode = 204; $resp.Close(); continue }
    try {
        if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/') {
            $j = (New-Object System.IO.StreamReader($req.InputStream)).ReadToEnd() | ConvertFrom-Json
            $vurl = $j.url
            if ($j.downloadMode -eq 'audio') {
                $fmt = 'ba/b'
            } else {
                $fmt = switch ($j.videoQuality) {
                    '360'  { '18/b[ext=mp4]/b' }
                    '720'  { '22/b[ext=mp4]/b' }
                    '144'  { 'b[ext=mp4]/b' }
                    default { 'b[ext=mp4]/b' }
                }
            }
            $g = & $YTDLP -f $fmt --no-warnings --skip-download -g $vurl 2>$null | Select-Object -First 1
            if (!$g) { throw 'yt-dlp não retornou URL' }
            $out  = @{ status = 'redirect'; url = $g; filename = 'ytgrab.mp4' } | ConvertTo-Json
        } else {
            $out = '{"status":"alive","service":"ytgrab-home"}'
        }
        $buf = [Text.Encoding]::UTF8.GetBytes($out)
        $resp.ContentType = 'application/json'
        $resp.OutputStream.Write($buf, 0, $buf.Length)
    } catch {
        $resp.StatusCode = 400
        $buf = [Text.Encoding]::UTF8.GetBytes('{"status":"error","error":{"code":"error.home.fail"}}')
        $resp.ContentType = 'application/json'
        $resp.OutputStream.Write($buf, 0, $buf.Length)
    }
    $resp.Close()
}
