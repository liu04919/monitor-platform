param(
    [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env")
)

$taskEnvPath = [System.IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $taskEnvPath -PathType Leaf)) {
    throw "Environment file not found: $taskEnvPath"
}

$taskImportedCount = 0
foreach ($taskEnvLine in Get-Content -LiteralPath $taskEnvPath) {
    if ($taskEnvLine -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        continue
    }

    $taskEnvName = $Matches[1]
    $taskEnvValue = $Matches[2].Trim()
    if ($taskEnvValue.Length -ge 2) {
        $taskFirstCharacter = $taskEnvValue[0]
        $taskLastCharacter = $taskEnvValue[$taskEnvValue.Length - 1]
        if (($taskFirstCharacter -eq '"' -and $taskLastCharacter -eq '"') -or
            ($taskFirstCharacter -eq "'" -and $taskLastCharacter -eq "'")) {
            $taskEnvValue = $taskEnvValue.Substring(1, $taskEnvValue.Length - 2)
        }
    }

    [Environment]::SetEnvironmentVariable($taskEnvName, $taskEnvValue, 'Process')
    $taskImportedCount++
}

Write-Host "Imported $taskImportedCount environment variables from $taskEnvPath"
