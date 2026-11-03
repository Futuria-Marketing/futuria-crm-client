[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$wizardScript = Join-Path $PSScriptRoot "credential-wizard.mjs"
$setupScript = Join-Path $PSScriptRoot "setup-credentials.ps1"

function Start-OutsideAgentJob {
    param(
        [Parameter(Mandatory)][string]$CommandLine
    )
    # Win32_Process.Create fa nascere il processo dal servizio WMI, fuori dal
    # job object dell'agente: il configuratore resta attivo quando il comando
    # o il turno dell'agente finisce. Se WMI non e' disponibile o e' bloccato,
    # restituisce $false e si usa Start-Process.
    try {
        $startup = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -Property @{ ShowWindow = [uint16]0 } -ClientOnly
        $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
            CommandLine = $CommandLine
            ProcessStartupInformation = $startup
        }
        return ($null -ne $result -and $result.ReturnValue -eq 0)
    } catch {
        return $false
    }
}

if (Test-Path -LiteralPath $wizardScript) {
    # Preferisce node.exe agli shim .cmd: evita l'interprete cmd e le sue
    # regole di quoting sui percorsi con caratteri speciali.
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($node) {
        # I percorsi di Windows non possono contenere virgolette: racchiuderli
        # tra virgolette basta a gestire gli spazi.
        $wizardArguments = @(('"{0}"' -f $wizardScript), '--detach')
        if ($Preview) { $wizardArguments += '--preview' }
        if ($NoOpen) { $wizardArguments += '--no-open' }
        $argumentLine = $wizardArguments -join ' '
        $commandLine = '"{0}" {1}' -f $node.Source, $argumentLine

        if (-not (Start-OutsideAgentJob -CommandLine $commandLine)) {
            Start-Process -FilePath $node.Source -ArgumentList $argumentLine -WindowStyle Hidden | Out-Null
        }
        Write-Output "Configuratore grafico Futuria CRM aperto nel browser."
        exit 0
    }
}

if (-not (Test-Path -LiteralPath $setupScript)) {
    throw "Script di configurazione Futuria CRM non trovato."
}

$argumentLine = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "{0}"' -f $setupScript.Replace('"', '""')
Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine -WindowStyle Normal | Out-Null
Write-Output "Node.js non è disponibile: aperta la configurazione protetta in PowerShell."
