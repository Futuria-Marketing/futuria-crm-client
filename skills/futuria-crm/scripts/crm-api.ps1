[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "POST", "PUT", "PATCH", "DELETE")]
    [string]$Method,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$Body,
    [string]$BodyFile,
    [string]$Version = "2021-07-28"
)

$ErrorActionPreference = "Stop"
# Messaggi solo ASCII: questo file non ha BOM e li legge l'agente.
. (Join-Path $PSScriptRoot "state-dir.ps1")

$location = @($env:FUTURIA_CRM_LOCATION, $env:FUTURIA_CRM_LOCATION_ID) |
    Where-Object { $_ } | Select-Object -First 1
$token = $env:FUTURIA_CRM_TOKEN
$keyState = "mancante"
if ($token) { $keyState = "presente" }

# Le variabili d'ambiente hanno la precedenza; la cartella della skill si
# consulta solo per il valore che manca.
if (-not $token -or -not $location) {
    $state = Resolve-FuturiaState
    if (-not $location -and $null -ne $state.Config) {
        $location = $state.Config.location
    }
    if (-not $token) {
        $keyState = $state.CredentialState
        if ($keyState -ceq "presente") {
            $token = $state.Credential.GetNetworkCredential().Password
        }
    }
    $state = $null
}

if ($keyState -ceq "non-leggibile") {
    throw "[futuria-crm:chiave-non-leggibile] Chiave privata presente ma non leggibile per questo utente Windows: ricollega l'account con launch-credential-setup.ps1."
}
if (-not $token -and -not $location) {
    throw "[futuria-crm:credenziali-mancanti] Credenziali Futuria CRM mancanti. Avvia il configuratore con launch-credential-setup.ps1."
}
if (-not $location) {
    $token = $null
    throw "[futuria-crm:id-mancante] Configurazione Futuria CRM incompleta: chiave privata presente, ID account mancante. Riapri il configuratore con launch-credential-setup.ps1 e ricollega l'account."
}
if (-not $token) {
    throw "[futuria-crm:chiave-mancante] Configurazione Futuria CRM incompleta: ID account presente, chiave privata mancante. Riapri il configuratore con launch-credential-setup.ps1."
}
if ($token -notmatch '^pit-[A-Za-z0-9._-]{6,2048}$') {
    throw "La chiave privata configurata non ha il formato atteso."
}
if ([string]$location -notmatch '^[A-Za-z0-9_-]{6,128}$') {
    throw "L'ID account configurato non ha il formato atteso."
}
if ($Version -notmatch '^(v[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2})$') {
    throw "La versione API richiesta non ha il formato atteso."
}
if (-not $Path.StartsWith("/") -or $Path.Contains("://")) {
    throw "Il percorso API deve essere relativo e iniziare con /. URL esterni non sono consentiti."
}

$safeLocation = [Uri]::EscapeDataString([string]$location)
$resolvedPath = $Path.Replace("{location}", $safeLocation)
$uri = "https://services.leadconnectorhq.com" + $resolvedPath
$headers = @{
    Authorization = "Bearer $token"
    Version = $Version
    Accept = "application/json"
}

if ($Body -and $BodyFile) {
    throw "Usa Body oppure BodyFile, non entrambi."
}
if ($BodyFile) {
    $Body = Get-Content -Raw -Encoding UTF8 -LiteralPath $BodyFile
}
if ($Body) {
    $Body = $Body.Replace("{location}", [string]$location)
}

try {
    $params = @{
        Method = $Method
        Uri = $uri
        Headers = $headers
    }
    if ($Body) {
        $params.ContentType = "application/json"
        $params.Body = [Text.Encoding]::UTF8.GetBytes($Body)
    }
    $response = Invoke-RestMethod @params
    if ($null -ne $response) {
        $response | ConvertTo-Json -Depth 100
    }
} catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode
    }
    $detail = $_.ErrorDetails.Message
    if (-not $detail) {
        $detail = $_.Exception.Message
    }
    throw "Errore Futuria CRM$(if ($status) { " HTTP $status" }): $detail"
} finally {
    $token = $null
    $headers.Authorization = $null
}
