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
    # o il turno dell'agente finisce. Restituisce il PID del processo creato,
    # oppure $null se WMI non e' disponibile, e' bloccato o non risponde.
    try {
        $startupClass = Get-CimClass -ClassName Win32_ProcessStartup -OperationTimeoutSec 15
        $startup = New-CimInstance -CimClass $startupClass -Property @{ ShowWindow = [uint16]0 } -ClientOnly
        $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -OperationTimeoutSec 15 -Arguments @{
            CommandLine = $CommandLine
            ProcessStartupInformation = $startup
        }
        if ($null -ne $result -and $result.ReturnValue -eq 0) {
            return [int]$result.ProcessId
        }
    } catch {
        # Nessun dettaglio: si passa al ripiego con Start-Process.
    }
    return $null
}

function Read-WizardResult {
    param(
        [Parameter(Mandatory)][string]$Path
    )
    # Esito scritto dal processo intermedio: ok, PID e indirizzo del
    # configuratore in ascolto, oppure il motivo per cui non e' partito.
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        return $null
    } finally {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path -LiteralPath $wizardScript) {
    # Preferisce node.exe agli shim .cmd: evita l'interprete cmd e le sue
    # regole di quoting sui percorsi con caratteri speciali.
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($node) {
        $resultFile = Join-Path ([System.IO.Path]::GetTempPath()) ("futuria-crm-avvio-{0}.json" -f [guid]::NewGuid().ToString("N"))
        # I percorsi di Windows non possono contenere virgolette: racchiuderli
        # tra virgolette basta a gestire gli spazi.
        $wizardArguments = @(('"{0}"' -f $wizardScript), '--detach', '--result-file', ('"{0}"' -f $resultFile))
        if ($Preview) { $wizardArguments += '--preview' }
        if ($NoOpen) { $wizardArguments += '--no-open' }
        $argumentLine = $wizardArguments -join ' '
        $commandLine = '"{0}" {1}' -f $node.Source, $argumentLine

        # Il processo intermedio esce appena il configuratore e' in ascolto,
        # o dopo al massimo 10 secondi, e scrive l'esito nel file indicato.
        $outcome = $null
        $usedFallback = $false
        $wmiProcessId = Start-OutsideAgentJob -CommandLine $commandLine
        if ($wmiProcessId) {
            Wait-Process -Id $wmiProcessId -Timeout 20 -ErrorAction SilentlyContinue
            $outcome = Read-WizardResult -Path $resultFile
        }

        if (-not ($outcome -and $outcome.ok)) {
            # Ripiego: il configuratore parte comunque, ma resta dentro il job
            # dell'agente e puo' chiudersi quando il comando finisce.
            $usedFallback = $true
            $process = Start-Process -FilePath $node.Source -ArgumentList $argumentLine -WindowStyle Hidden -PassThru
            if (-not $process.WaitForExit(20000)) {
                try { $process.Kill() } catch { }
            }
            $outcome = Read-WizardResult -Path $resultFile
        }

        if (-not ($outcome -and $outcome.ok)) {
            $reason = "nessuna risposta dal configuratore."
            if ($outcome -and $outcome.message) { $reason = [string]$outcome.message }
            [Console]::Error.WriteLine("Impossibile avviare il configuratore grafico Futuria CRM: $reason")
            exit 1
        }

        if ($NoOpen) {
            Write-Output ("Configuratore Futuria CRM disponibile su {0} (processo separato, PID {1})." -f $outcome.url, $outcome.pid)
        } else {
            Write-Output ("Configuratore grafico Futuria CRM aperto nel browser (processo separato, PID {0})." -f $outcome.pid)
            Write-Output ("Se la pagina non si e' aperta, apri questo indirizzo nel browser: {0}" -f $outcome.url)
        }
        if ($usedFallback) {
            Write-Output "Attenzione: configuratore avviato senza WMI, puo' chiudersi alla fine del comando dell'agente. Se la pagina segnala la chiusura, rilancia il launcher fuori dalla sandbox o con permessi elevati."
        }
        exit 0
    }
}

if (-not (Test-Path -LiteralPath $setupScript)) {
    throw "Script di configurazione Futuria CRM non trovato."
}

$argumentLine = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "{0}"' -f $setupScript.Replace('"', '""')
Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine -WindowStyle Normal | Out-Null
Write-Output "Node.js non è disponibile: aperta la configurazione protetta in PowerShell."
