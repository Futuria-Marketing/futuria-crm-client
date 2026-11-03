[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Remove,
    [switch]$FromStdin
)

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:APPDATA "Futuria CRM"
$credentialPath = Join-Path $stateDir "credential.xml"
$configPath = Join-Path $stateDir "config.json"

if ($FromStdin -and ($Status -or $Remove)) {
    throw "FromStdin non può essere combinato con Status o Remove."
}

function Test-LocationId {
    param([string]$Value)
    return $Value -match '^[A-Za-z0-9_-]{6,128}$'
}

if ($Status) {
    $credentialOk = $false
    if (Test-Path -LiteralPath $credentialPath) {
        try {
            $stored = Import-Clixml -LiteralPath $credentialPath
            $credentialOk = $stored -is [System.Management.Automation.PSCredential]
        } catch {
            $credentialOk = $false
        }
    }
    $locationOk = Test-Path -LiteralPath $configPath
    Write-Output ("Chiave privata protetta: {0}" -f $(if ($credentialOk) { "presente" } else { "mancante" }))
    Write-Output ("ID account: {0}" -f $(if ($locationOk) { "presente" } else { "mancante" }))
    exit $(if ($credentialOk -and $locationOk) { 0 } else { 1 })
}

if ($Remove) {
    if (Test-Path -LiteralPath $credentialPath) {
        Remove-Item -LiteralPath $credentialPath -Force
    }
    if (Test-Path -LiteralPath $configPath) {
        Remove-Item -LiteralPath $configPath -Force
    }
    if ((Test-Path -LiteralPath $stateDir) -and -not (Get-ChildItem -LiteralPath $stateDir -Force)) {
        Remove-Item -LiteralPath $stateDir -Force
    }
    Write-Output "Credenziali locali Futuria CRM rimosse. La chiave privata remota non è stata revocata."
    exit 0
}

if ($FromStdin) {
    $locationLine = [Console]::In.ReadLine()
    $plainPit = [Console]::In.ReadLine()
    if ($null -eq $locationLine -or $null -eq $plainPit) {
        throw "Dati di configurazione incompleti."
    }
    $location = $locationLine.Trim()
    $securePit = ConvertTo-SecureString $plainPit -AsPlainText -Force
} else {
    Write-Host "Configurazione protetta Futuria CRM" -ForegroundColor Cyan
    Write-Host "Inserisci i valori in questa finestra. La chiave privata non verrà mostrata né scritta nella chat."
    $location = (Read-Host "ID del tuo account Futuria CRM").Trim()
    $securePit = Read-Host "Private Integration Token (PIT), input nascosto" -AsSecureString
}

if (-not (Test-LocationId $location)) {
    throw "ID account non valido: usa soltanto lettere, numeri, trattino o underscore."
}

$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePit)
try {
    $plainPitForValidation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($plainPitForValidation -notmatch '^pit-[A-Za-z0-9._-]{6,2048}$') {
        throw "La chiave privata non ha il formato atteso. Deve iniziare con pit-."
    }
} finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    $plainPit = $null
    $plainPitForValidation = $null
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$credential = [System.Management.Automation.PSCredential]::new("futuria-crm", $securePit)
$credential | Export-Clixml -LiteralPath $credentialPath -Force

$configJson = @{
    location = $location
    updated_at = (Get-Date).ToUniversalTime().ToString("o")
    storage = "windows-dpapi"
} | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $configJson + [Environment]::NewLine, $utf8NoBom)

if ($FromStdin) {
    Write-Output "Configurazione protetta Futuria CRM salvata."
} else {
    Write-Host "Configurazione salvata per l'utente Windows corrente." -ForegroundColor Green
    Write-Host "Puoi chiudere questa finestra e tornare all'agente."
}
