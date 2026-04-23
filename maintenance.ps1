#requires -Version 5.1
# ZaloCRM - Script bao tri
# Chay: .\maintenance.ps1  hoac chuot phai > Run with PowerShell

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Get-DockerCmd {
    $candidates = @(
        'docker',
        'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
    )
    foreach ($c in $candidates) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { return $c }
        if (Test-Path $c) { return $c }
    }
    throw "Khong tim thay docker. Docker Desktop da cai chua?"
}

function Invoke-Docker { & $script:DOCKER @args }
function Invoke-Compose { & $script:DOCKER compose -f "$ScriptDir\docker-compose.yml" --project-directory $ScriptDir @args }

function Show-Status {
    Write-Host "`n== Trang thai container ==" -ForegroundColor Cyan
    Invoke-Compose ps
    Write-Host "`n== Kiem tra HTTP ==" -ForegroundColor Cyan
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:3080/' -TimeoutSec 5 -UseBasicParsing
        Write-Host "OK - HTTP $($r.StatusCode) tai http://localhost:3080" -ForegroundColor Green
    } catch {
        Write-Host "KHONG PHAN HOI - $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Fix-AiModelId {
    Write-Host "`n== Fix bug: model ID sai dau cham trong ai_configs ==" -ForegroundColor Cyan
    $sql = @"
UPDATE ai_configs SET model='claude-sonnet-4-6', updated_at=NOW() WHERE model='claude-sonnet-4.6';
UPDATE ai_configs SET model='claude-opus-4-6',   updated_at=NOW() WHERE model='claude-opus-4.6';
UPDATE ai_configs SET model='claude-haiku-4-5',  updated_at=NOW() WHERE model='claude-haiku-4.5';
SELECT id, provider, model FROM ai_configs;
"@
    Invoke-Docker exec -i zalo-crm-db psql -U crmuser -d zalocrm -c $sql
}

function Update-App {
    Write-Host "`n== Cap nhat ZaloCRM len ban moi nhat ==" -ForegroundColor Cyan
    Write-Host "1/3 git pull..." -ForegroundColor Yellow
    git pull
    Write-Host "2/3 docker compose build + up..." -ForegroundColor Yellow
    Invoke-Compose up -d --build
    Write-Host "3/3 Dang cho app khoi dong (10s)..." -ForegroundColor Yellow
    Start-Sleep 10
    Show-Status
}

function Restart-App {
    Write-Host "`n== Restart container app ==" -ForegroundColor Cyan
    Invoke-Compose restart app
    Start-Sleep 5
    Invoke-Compose ps
}

function Show-Logs {
    Write-Host "`n== 50 dong log cuoi cua app ==" -ForegroundColor Cyan
    Invoke-Docker logs zalo-crm-app --tail 50
}

function Rebuild-FromEnv {
    Write-Host "`n== Recreate app de load lai .env ==" -ForegroundColor Cyan
    Invoke-Compose up -d --force-recreate app
    Start-Sleep 5
    Invoke-Compose ps
}

function Stop-All { Invoke-Compose down; Write-Host "Da dung tat ca container" -ForegroundColor Green }
function Start-All { Invoke-Compose up -d; Start-Sleep 5; Show-Status }

function Backup-Db {
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $out = "$ScriptDir\backup-$ts.sql"
    Write-Host "`n== Tao backup thu cong -> $out ==" -ForegroundColor Cyan
    Invoke-Docker exec zalo-crm-db pg_dump -U crmuser zalocrm | Out-File -Encoding utf8 $out
    Write-Host "Xong. Dung luong: $((Get-Item $out).Length) bytes" -ForegroundColor Green
}

function Show-Menu {
    Write-Host ""
    Write-Host "===== ZaloCRM Maintenance =====" -ForegroundColor Cyan
    Write-Host " 1) Xem trang thai + kiem tra HTTP"
    Write-Host " 2) Fix bug model ID AI (claude-*-4.6 -> -4-6)"
    Write-Host " 3) Cap nhat len ban moi nhat (git pull + rebuild)"
    Write-Host " 4) Recreate app (load lai .env)"
    Write-Host " 5) Restart app"
    Write-Host " 6) Xem 50 dong log cuoi"
    Write-Host " 7) Backup database thu cong"
    Write-Host " 8) Dung tat ca container"
    Write-Host " 9) Khoi dong tat ca container"
    Write-Host " 0) Thoat"
    Write-Host ""
}

$script:DOCKER = Get-DockerCmd
Write-Host "Docker: $script:DOCKER" -ForegroundColor DarkGray
Write-Host "Project: $ScriptDir" -ForegroundColor DarkGray

do {
    Show-Menu
    $choice = Read-Host "Chon"
    try {
        switch ($choice) {
            '1' { Show-Status }
            '2' { Fix-AiModelId }
            '3' { Update-App }
            '4' { Rebuild-FromEnv }
            '5' { Restart-App }
            '6' { Show-Logs }
            '7' { Backup-Db }
            '8' { Stop-All }
            '9' { Start-All }
            '0' { break }
            default { Write-Host "Lua chon khong hop le" -ForegroundColor Yellow }
        }
    } catch {
        Write-Host "LOI: $($_.Exception.Message)" -ForegroundColor Red
    }
} while ($choice -ne '0')
