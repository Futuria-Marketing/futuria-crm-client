[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Remove,
    [switch]$FromStdin
)

# Le righe lette dall'agente (Write-Output e throw) restano in ASCII: con
# l'output rediretto Windows PowerShell 5.1 scrive nella code page OEM e gli
# accenti arriverebbero illeggibili. Accenti e apostrofi tipografici solo nei
# Write-Host della finestra interattiva (il file ha il BOM UTF-8 per questo).

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "state-dir.ps1")

if ($FromStdin -and ($Status -or $Remove)) {
    throw "FromStdin non puo' essere combinato con Status o Remove."
}

function Test-LocationId {
    param([string]$Value)
    return $Value -cmatch '^[A-Za-z0-9_-]{6,128}$'
}

function Complete-FuturiaReplace {
    param([string]$Source, [string]$Destination)
    # Sostituzione atomica del file finale: Replace se esiste gia', Move se
    # manca. Qualche tentativo in piu' se un altro processo lo sta leggendo.
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            if (Test-Path -LiteralPath $Destination -PathType Leaf) {
                [System.IO.File]::Replace($Source, $Destination, [NullString]::Value)
            } else {
                [System.IO.File]::Move($Source, $Destination)
            }
            return
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Remove-FuturiaFileWithRetry {
    param([string]$Path)
    # Cancella il file se c'e', con qualche tentativo in piu' se un altro
    # processo lo sta leggendo; se non ci riesce interrompe il salvataggio.
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            if (-not (Test-Path -LiteralPath $Path)) { return }
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 5) { throw }
            Start-Sleep -Milliseconds 100
        }
    }
}

if ($Status) {
    try {
        $state = Resolve-FuturiaState
    } catch {
        Write-Output $_.Exception.Message
        exit 1
    }
    $keyState = $state.CredentialState
    $idOk = $null -ne $state.Config
    $keyLabel = 'mancante'
    if ($keyState -ceq 'presente') { $keyLabel = 'presente' }
    if ($keyState -ceq 'non-leggibile') { $keyLabel = 'non leggibile' }
    Write-Output ("Chiave privata protetta: {0}" -f $keyLabel)
    Write-Output ("ID account: {0}" -f $(if ($idOk) { "presente" } else { "mancante" }))
    if ($state.Migration -ceq 'copied' -or ($state.Migration -ceq 'copied-key' -and $idOk)) {
        Write-Output "Configurazione della versione precedente copiata nella nuova cartella."
    }
    if ($state.Migration -ceq 'copied-key' -and -not $idOk) {
        Write-Output "Chiave privata della versione precedente copiata nella nuova cartella, senza ID account."
    }
    if ($state.Migration -ceq 'fallback') {
        Write-Output "Configurazione letta in sola lettura dalla cartella della versione precedente: la copia nella nuova cartella e' rimandata."
    }
    if ($keyState -ceq 'presente' -and -not $idOk) {
        Write-Output "Serve ricollegare l'account: apri di nuovo il configuratore."
    }
    if ($keyState -ceq 'non-leggibile') {
        Write-Output "La chiave privata salvata non e' leggibile per questo utente Windows: ricollega l'account con il configuratore."
    }
    if (Test-FuturiaLegacyNewer $state.Paths) {
        Write-Output "Un'altra installazione del plugin non aggiornata usa ancora la vecchia cartella: aggiornala."
    }
    $state = $null
    exit $(if ($keyState -ceq 'presente' -and $idOk) { 0 } else { 1 })
}

if ($Remove) {
    try {
        $paths = Get-FuturiaStatePaths
    } catch {
        Write-Output $_.Exception.Message
        exit 1
    }
    $failed = $false
    $keptLegacyConfig = $false
    $legacyKeyKept = $false

    # Prima la cartella usata fino alla 1.3.2, condivisa con l'app desktop:
    # soltanto i file riconosciuti come della skill, mai la cartella stessa.
    # Va per prima perche' da li' la prossima chiamata ricopierebbe i file
    # nella cartella nuova.
    if ($paths.LegacyDir -and (Test-Path -LiteralPath $paths.LegacyDir -PathType Container)) {
        if (Test-FuturiaCredentialFile $paths.LegacyCredentialPath) {
            try { Remove-Item -LiteralPath $paths.LegacyCredentialPath -Force -ErrorAction Stop } catch { $failed = $true; $legacyKeyKept = $true }
        }
        $legacyText = Read-FuturiaSmallText $paths.LegacyConfigPath $FuturiaConfigMaxBytes
        if ($null -ne (ConvertFrom-FuturiaConfigText $legacyText)) {
            if (Test-FuturiaDesktopAppRunning) {
                # L'app potrebbe riscriverlo in questo momento: resta dov'e'.
                # Senza la vecchia chiave non viene piu' ricopiato.
                $keptLegacyConfig = $true
            } else {
                $again = Read-FuturiaSmallText $paths.LegacyConfigPath $FuturiaConfigMaxBytes
                if ($null -ne $again -and $again -ceq $legacyText) {
                    try { Remove-Item -LiteralPath $paths.LegacyConfigPath -Force -ErrorAction Stop } catch { $failed = $true }
                }
            }
        }
    }

    # Poi la cartella della skill: soltanto i nomi noti, poi la cartella se e'
    # vuota. Se la vecchia chiave e' rimasta resta com'e', cosi' la rimozione
    # incompleta non cambia lo stato e si puo' ripetere.
    if (-not $legacyKeyKept) {
        foreach ($file in @($paths.CredentialPath, $paths.ConfigPath)) {
            if (Test-Path -LiteralPath $file -PathType Leaf) {
                try { Remove-Item -LiteralPath $file -Force -ErrorAction Stop } catch { $failed = $true }
            }
        }
        if (Test-Path -LiteralPath $paths.Dir -PathType Container) {
            Get-ChildItem -LiteralPath $paths.Dir -Force -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -cmatch $FuturiaTempNamePattern } |
                ForEach-Object {
                    try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch { $failed = $true }
                }
            if (-not (Get-ChildItem -LiteralPath $paths.Dir -Force -ErrorAction SilentlyContinue)) {
                try { Remove-Item -LiteralPath $paths.Dir -Force -ErrorAction Stop } catch { $failed = $true }
            }
        }
    }

    if ($failed) {
        Write-Output "[futuria-crm:rimozione-incompleta] Non e' stato possibile rimuovere tutti i file locali Futuria CRM: chiudi i programmi che li usano e ripeti la rimozione."
        exit 1
    }
    Write-Output "Credenziali locali Futuria CRM rimosse. La chiave privata remota non e' stata revocata."
    if ($keptLegacyConfig) {
        Write-Output "Chiudi l'app desktop Futuria CRM e ripeti la rimozione per togliere anche la vecchia copia dell'ID account."
    }
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

# Si scrive soltanto nella cartella della skill, mai in quella della versione
# precedente o dell'app desktop. Entrambi i file nascono come temporanei. Poi
# si toglie l'ID account precedente, si sostituisce la chiave e per ultimo si
# mette il nuovo ID: un'interruzione lascia al massimo "chiave presente, ID
# mancante" (lo Status chiede di ricollegare l'account), non la chiave nuova
# accanto all'ID di prima. Se l'ID precedente non si puo' togliere non cambia
# nulla e il collegamento precedente resta intero.
$paths = Get-FuturiaStatePaths
New-Item -ItemType Directory -Path $paths.Dir -Force | Out-Null
$credentialTemp = New-FuturiaTempPath $paths.Dir 'credential'
$configTemp = New-FuturiaTempPath $paths.Dir 'config'
$keyReplaced = $false
try {
    $credential = [System.Management.Automation.PSCredential]::new("futuria-crm", $securePit)
    $credential | Export-Clixml -LiteralPath $credentialTemp
    $configText = Format-FuturiaConfigText $location ((Get-Date).ToUniversalTime().ToString("o"))
    Set-Content -LiteralPath $configTemp -Value $configText -Encoding ASCII -NoNewline
    Remove-FuturiaFileWithRetry $paths.ConfigPath
    Complete-FuturiaReplace $credentialTemp $paths.CredentialPath
    $keyReplaced = $true
    Complete-FuturiaReplace $configTemp $paths.ConfigPath
} catch {
    # La chiave nuova e' gia' al suo posto: mai lasciarla accanto a un ID
    # diverso dal suo.
    if ($keyReplaced) {
        Remove-Item -LiteralPath $paths.ConfigPath -Force -ErrorAction SilentlyContinue
    }
    throw
} finally {
    $credential = $null
    foreach ($temp in @($credentialTemp, $configTemp)) {
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($FromStdin) {
    Write-Output "Configurazione protetta Futuria CRM salvata."
} else {
    Write-Host "Configurazione salvata per l’utente Windows corrente." -ForegroundColor Green
    Write-Host "Puoi chiudere questa finestra e tornare all’agente."
}
