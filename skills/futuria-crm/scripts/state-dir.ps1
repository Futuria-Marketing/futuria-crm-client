# Cartella di stato della skill Futuria CRM su Windows.
#
# Caricato con dot-sourcing da setup-credentials.ps1 e crm-api.ps1.
# Regole di questo file:
# - solo ASCII e senza BOM, cosi' Windows PowerShell 5.1 lo legge sempre uguale;
# - solo cmdlet e operatori ammessi in Constrained Language Mode, nessuna classe
#   .NET: lo stato deve leggersi anche sui PC con criteri aziendali;
# - percorsi sempre con -LiteralPath (nomi utente con apostrofi o parentesi);
# - confronti sempre case-sensitive (-cmatch, -ceq, -cin).
#
# La cartella della skill sta nel profilo utente, fuori da AppData: e' separata
# dall'app desktop Futuria CRM (la cui cartella e' %APPDATA%\Futuria CRM) e non
# viene virtualizzata quando l'agente gira dentro un pacchetto MSIX.
# Il nome e' identico in credential-wizard.mjs (controllato dal validatore).

$FuturiaStateDirName = '.futuria-crm-skill'
# Cartella usata dalle versioni 1.1.0-1.3.2 e dall'app desktop: solo lettura,
# tranne la rimozione esplicita dei file della skill.
$FuturiaLegacyDirName = 'Futuria CRM'
$FuturiaConfigMaxBytes = 1024
$FuturiaCredentialMaxBytes = 16384
$FuturiaTempMaxAgeMinutes = 10
$FuturiaTempNamePattern = '^\.(config|credential)-[0-9a-f]{16}\.tmp$'
$FuturiaDesktopProcessName = 'Futuria CRM'

function Test-FuturiaWindowsRoot {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $false }
    if ($Value -cmatch '[\x00-\x1f]') { return $false }
    # Percorso assoluto con lettera di unita' (C:\...) oppure UNC
    # (\\server\condivisione\...). Restano fuori C:foo, \foo, \\?\ e \\.\.
    if (-not (($Value -cmatch '^[A-Za-z]:[\\/]') -or ($Value -cmatch '^\\\\[^\\/?.][^\\/]*[\\/][^\\/]+'))) { return $false }
    if ($Value -cmatch '(^|[\\/])\.\.([\\/]|$)') { return $false }
    return $true
}

function Join-FuturiaPath {
    param([string]$Parent, [string]$Child)
    # Concatenazione semplice: Join-Path fallisce se l'unita' non esiste.
    return ($Parent.TrimEnd([char]'\', [char]'/') + '\' + $Child)
}

function Get-FuturiaStatePaths {
    $profileRoot = $env:USERPROFILE
    if (-not (Test-FuturiaWindowsRoot $profileRoot)) {
        throw "[futuria-crm:cartella-non-valida] La cartella del profilo utente Windows (USERPROFILE) non e' valida: la configurazione Futuria CRM non si puo' usare."
    }
    $dir = Join-FuturiaPath $profileRoot $FuturiaStateDirName
    $paths = @{
        Dir = $dir
        CredentialPath = Join-FuturiaPath $dir 'credential.xml'
        ConfigPath = Join-FuturiaPath $dir 'config.json'
        LegacyDir = $null
        LegacyCredentialPath = $null
        LegacyConfigPath = $null
    }
    # Un APPDATA vuoto o anomalo vuol dire soltanto: nessuna copia precedente.
    if (Test-FuturiaWindowsRoot $env:APPDATA) {
        $legacy = Join-FuturiaPath $env:APPDATA $FuturiaLegacyDirName
        $paths.LegacyDir = $legacy
        $paths.LegacyCredentialPath = Join-FuturiaPath $legacy 'credential.xml'
        $paths.LegacyConfigPath = Join-FuturiaPath $legacy 'config.json'
    }
    return $paths
}

function Write-FuturiaNotice {
    param([string]$Message)
    # Avvisi per l'agente su stderr, senza valori. In Constrained Language Mode
    # $host.UI non e' disponibile e si ripiega su Write-Warning.
    try {
        if ($ExecutionContext.SessionState.LanguageMode -ceq 'FullLanguage') {
            $host.UI.WriteErrorLine($Message)
            return
        }
    } catch { }
    Write-Warning $Message
}

function Test-FuturiaPlainFile {
    param([AllowNull()][string]$Path, [int]$MaxBytes)
    # File normale (non cartella, non collegamento) entro il limite di dimensione.
    if ([string]::IsNullOrEmpty($Path)) { return $false }
    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (([string]$item.Attributes) -cmatch 'ReparsePoint') { return $false }
        return ($item.Length -le $MaxBytes)
    } catch {
        return $false
    }
}

function Read-FuturiaSmallText {
    param([AllowNull()][string]$Path, [int]$MaxBytes)
    # Il contenuto non viene mai stampato: si usa solo per la classificazione.
    if (-not (Test-FuturiaPlainFile $Path $MaxBytes)) { return $null }
    try {
        $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
    } catch {
        return $null
    }
    if ($null -eq $text) { $text = '' }
    $text = [string]$text
    if ($text.Length -gt 0 -and $text[0] -ceq [char]0xFEFF) { $text = $text.Substring(1) }
    # Il file potrebbe essere cambiato tra il controllo e la lettura.
    if ($text.Length -gt $MaxBytes) { return $null }
    return $text
}

function ConvertFrom-FuturiaConfigText {
    param([AllowNull()][string]$Text)
    # Stessa regola in state-dir.sh e credential-wizard.mjs, sul testo grezzo:
    # un oggetto JSON con le sole chiavi location, storage e updated_at, tutte
    # stringhe semplici, senza duplicati e senza maiuscole diverse.
    if ($null -eq $Text) { return $null }
    if ($Text.Length -gt $FuturiaConfigMaxBytes) { return $null }
    if ($Text.Length -gt 0 -and $Text[0] -ceq [char]0xFEFF) { $Text = $Text.Substring(1) }
    if (-not ($Text -cmatch '^[ \t\r\n]*\{([\s\S]*)\}[ \t\r\n]*$')) { return $null }
    $body = $Matches[1]
    $values = @{}
    $needPair = $false
    while ($true) {
        $body = $body -creplace '^[ \t\r\n]+', ''
        if ($body.Length -eq 0) {
            if ($needPair) { return $null }
            break
        }
        if (-not ($body -cmatch '^"([A-Za-z_]+)"[ \t\r\n]*:[ \t\r\n]*"([A-Za-z0-9_.:+-]*)"([\s\S]*)$')) { return $null }
        $key = $Matches[1]
        $value = $Matches[2]
        $rest = $Matches[3] -creplace '^[ \t\r\n]+', ''
        if (-not ($key -cin @('location', 'storage', 'updated_at'))) { return $null }
        if ($values.ContainsKey($key)) { return $null }
        $values[$key] = $value
        if ($rest.Length -eq 0) { break }
        if ($rest.Substring(0, 1) -cne ',') { return $null }
        $body = $rest.Substring(1)
        $needPair = $true
    }
    if (-not ($values.ContainsKey('location') -and $values['location'] -cmatch '^[A-Za-z0-9_-]{6,128}$')) { return $null }
    if (-not ($values.ContainsKey('storage') -and $values['storage'] -ceq 'windows-dpapi')) { return $null }
    if (-not ($values.ContainsKey('updated_at') -and $values['updated_at'] -cmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,7})?Z$')) { return $null }
    return @{
        location = $values['location']
        storage = $values['storage']
        updated_at = $values['updated_at']
    }
}

function Format-FuturiaConfigText {
    param([string]$Location, [string]$UpdatedAt)
    return ('{{{0}  "location": "{1}",{0}  "storage": "windows-dpapi",{0}  "updated_at": "{2}"{0}}}{0}' -f "`n", $Location, $UpdatedAt)
}

function Test-FuturiaCredentialFile {
    param([AllowNull()][string]$Path)
    # Riconosce il credential.xml della skill dalla struttura, senza decifrarlo:
    # un PSCredential con UserName "futuria-crm", come lo scrive la skill.
    if (-not (Test-FuturiaPlainFile $Path $FuturiaCredentialMaxBytes)) { return $false }
    try {
        $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    } catch {
        return $false
    }
    if ($null -eq $text) { return $false }
    return (($text -cmatch '<T>System\.Management\.Automation\.PSCredential</T>') -and ($text -cmatch '<S N="UserName">futuria-crm</S>'))
}

function Read-FuturiaCredential {
    param([AllowNull()][string]$Path)
    # Stato della chiave: presente, mancante oppure non-leggibile (file presente
    # ma non decifrabile per questo utente o non valido).
    if ([string]::IsNullOrEmpty($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @{ State = 'mancante'; Credential = $null }
    }
    try {
        $stored = Import-Clixml -LiteralPath $Path -ErrorAction Stop
    } catch {
        return @{ State = 'non-leggibile'; Credential = $null }
    }
    if (($stored -is [System.Management.Automation.PSCredential]) -and ($stored.UserName -ceq 'futuria-crm')) {
        return @{ State = 'presente'; Credential = $stored }
    }
    # In Constrained Language Mode Import-Clixml restituisce una copia
    # "Deserialized" del PSCredential: la si ricompone dalla SecureString.
    if (($null -ne $stored) -and
        ($stored.psobject.TypeNames -ccontains 'Deserialized.System.Management.Automation.PSCredential') -and
        ($stored.UserName -ceq 'futuria-crm') -and
        ($stored.Password -is [securestring])) {
        try {
            return @{ State = 'presente'; Credential = [System.Management.Automation.PSCredential]::new($stored.UserName, $stored.Password) }
        } catch { }
    }
    return @{ State = 'non-leggibile'; Credential = $null }
}

function New-FuturiaTempPath {
    param([string]$Dir, [string]$Kind)
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 16)
    return (Join-FuturiaPath $Dir ('.{0}-{1}.tmp' -f $Kind, $suffix))
}

function Remove-FuturiaStaleTemps {
    param([string]$Dir)
    # Temporanei propri lasciati da un processo interrotto, riconosciuti dal
    # nome esatto e piu' vecchi di 10 minuti.
    try {
        if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return }
        $limit = (Get-Date).AddMinutes(-$FuturiaTempMaxAgeMinutes)
        Get-ChildItem -LiteralPath $Dir -Force -File -ErrorAction Stop |
            Where-Object { ($_.Name -cmatch $FuturiaTempNamePattern) -and ($_.LastWriteTime -lt $limit) } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    } catch { }
}

function Move-FuturiaNoOverwrite {
    param([string]$Source, [string]$Destination)
    # Rinomina senza sovrascrivere: se la destinazione esiste gia' fallisce.
    # Restituisce $true se il file e' stato spostato, $false se c'era gia'.
    try {
        Move-Item -LiteralPath $Source -Destination $Destination -ErrorAction Stop
        return $true
    } catch {
        if (Test-Path -LiteralPath $Destination -PathType Leaf) { return $false }
        throw
    }
}

function Invoke-FuturiaMigration {
    param($Paths)
    # Copia (mai sposta) i file della skill dalla cartella usata fino alla
    # 1.3.2. Va chiamata solo quando la cartella nuova non contiene ne' la
    # chiave ne' la configurazione. La cartella vecchia resta com'e': nessuna
    # scrittura, nessuna cancellazione, nessun file temporaneo.
    $result = @{ Status = 'none'; LegacyCredentialOk = $false; LegacyConfig = $null }
    if (-not $Paths.LegacyDir) { return $result }
    if (-not (Test-Path -LiteralPath $Paths.LegacyDir -PathType Container)) { return $result }

    if (Test-FuturiaCredentialFile $Paths.LegacyCredentialPath) {
        $legacyCredential = Read-FuturiaCredential $Paths.LegacyCredentialPath
        $result.LegacyCredentialOk = ($legacyCredential.State -ceq 'presente')
        $legacyCredential = $null
    }
    $result.LegacyConfig = ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $Paths.LegacyConfigPath $FuturiaConfigMaxBytes)
    if (-not $result.LegacyCredentialOk -and $null -eq $result.LegacyConfig) { return $result }

    $credentialTemp = $null
    $configTemp = $null
    try {
        New-Item -ItemType Directory -Path $Paths.Dir -Force -ErrorAction Stop | Out-Null
        # Prima la chiave, per ultima la configurazione.
        if ($result.LegacyCredentialOk) {
            $credentialTemp = New-FuturiaTempPath $Paths.Dir 'credential'
            Copy-Item -LiteralPath $Paths.LegacyCredentialPath -Destination $credentialTemp -ErrorAction Stop
            if ((Read-FuturiaCredential $credentialTemp).State -cne 'presente') {
                throw 'copia della chiave non leggibile'
            }
            if (-not (Move-FuturiaNoOverwrite $credentialTemp $Paths.CredentialPath)) {
                # Un altro processo ha gia' copiato: va bene se la sua copia e' valida.
                if ((Read-FuturiaCredential $Paths.CredentialPath).State -cne 'presente') {
                    throw 'chiave gia'' presente ma non valida'
                }
            }
        }
        if ($null -ne $result.LegacyConfig) {
            $configTemp = New-FuturiaTempPath $Paths.Dir 'config'
            $text = Format-FuturiaConfigText $result.LegacyConfig.location $result.LegacyConfig.updated_at
            Set-Content -LiteralPath $configTemp -Value $text -Encoding ASCII -NoNewline -ErrorAction Stop
            if ($null -eq (ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $configTemp $FuturiaConfigMaxBytes))) {
                throw 'copia della configurazione non valida'
            }
            if (-not (Move-FuturiaNoOverwrite $configTemp $Paths.ConfigPath)) {
                if ($null -eq (ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $Paths.ConfigPath $FuturiaConfigMaxBytes))) {
                    throw 'configurazione gia'' presente ma non valida'
                }
            }
        }
        $result.Status = 'copied'
    } catch {
        # Permessi, sandbox, antivirus o disco pieno: la chiamata continua in
        # sola lettura con i file della versione precedente.
        $result.Status = 'fallback'
        Write-FuturiaNotice "[futuria-crm:copia-rimandata] Non e' stato possibile copiare la configurazione della versione precedente nella nuova cartella: la uso in sola lettura e la copia verra' ritentata alla prossima esecuzione."
    } finally {
        foreach ($temp in @($credentialTemp, $configTemp)) {
            if ($temp -and (Test-Path -LiteralPath $temp)) {
                Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
            }
        }
    }
    return $result
}

function Resolve-FuturiaState {
    # Stato della skill per Status e crm-api: chiave e ID account dalla cartella
    # nuova; se la cartella nuova non contiene ne' l'una ne' l'altro, copia
    # prima i file della versione precedente (o li legge in sola lettura se la
    # copia non riesce). Non stampa mai valori.
    $paths = Get-FuturiaStatePaths
    Remove-FuturiaStaleTemps $paths.Dir
    $state = @{
        Paths = $paths
        Migration = 'none'
        CredentialState = 'mancante'
        Credential = $null
        Config = $null
    }
    $credentialPath = $paths.CredentialPath
    $hasNewCredential = Test-Path -LiteralPath $paths.CredentialPath
    $hasNewConfig = Test-Path -LiteralPath $paths.ConfigPath
    if (-not $hasNewCredential -and -not $hasNewConfig) {
        $migration = $null
        try {
            $migration = Invoke-FuturiaMigration $paths
        } catch {
            $migration = @{ Status = 'none'; LegacyCredentialOk = $false; LegacyConfig = $null }
        }
        $state.Migration = $migration.Status
        if ($migration.Status -ceq 'fallback') {
            if ($migration.LegacyCredentialOk) { $credentialPath = $paths.LegacyCredentialPath }
            $state.Config = $migration.LegacyConfig
        }
    }
    $credential = Read-FuturiaCredential $credentialPath
    $state.CredentialState = $credential.State
    $state.Credential = $credential.Credential
    if ($state.Migration -cne 'fallback') {
        $state.Config = ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $paths.ConfigPath $FuturiaConfigMaxBytes)
    }
    return $state
}

function Test-FuturiaLegacyNewer {
    param($Paths)
    # Una chiave della skill nella cartella vecchia piu' recente della copia
    # nuova vuol dire che un'installazione non aggiornata (1.3.2 o precedente)
    # ha ricollegato l'account dopo la copia.
    try {
        if (-not $Paths.LegacyCredentialPath) { return $false }
        if (-not (Test-Path -LiteralPath $Paths.CredentialPath -PathType Leaf)) { return $false }
        if (-not (Test-FuturiaCredentialFile $Paths.LegacyCredentialPath)) { return $false }
        $legacyTime = (Get-Item -LiteralPath $Paths.LegacyCredentialPath -Force -ErrorAction Stop).LastWriteTimeUtc
        $newTime = (Get-Item -LiteralPath $Paths.CredentialPath -Force -ErrorAction Stop).LastWriteTimeUtc
        return ($legacyTime -gt $newTime)
    } catch {
        return $false
    }
}

function Test-FuturiaDesktopAppRunning {
    $process = Get-Process -Name $FuturiaDesktopProcessName -ErrorAction SilentlyContinue
    return ($null -ne $process)
}
