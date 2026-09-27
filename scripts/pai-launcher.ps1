# Pi Desktop pai launcher (managed by scripts/install-pai.mjs)
param([Parameter(Position = 0)][string]$Cwd)

$ErrorActionPreference = 'Stop'

# ProcessStartInfo.Arguments uses Windows command-line quoting. Escape quotes
# and double trailing backslashes so drive roots and quoted arguments survive.
function ConvertTo-NativeArgument([string]$Value) {
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

try {
  if ([string]::IsNullOrWhiteSpace($Cwd)) {
    $Cwd = (Get-Location).ProviderPath
  }
  $directory = Get-Item -LiteralPath $Cwd
  if (-not $directory.PSIsContainer -or $directory.PSProvider.Name -ne 'FileSystem') {
    throw 'pai requires a filesystem directory.'
  }
  $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'pai-launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not (Test-Path -LiteralPath $config.executable -PathType Leaf)) {
    throw "Pi Desktop executable was not found: $($config.executable). Reinstall the pai command."
  }

  $arguments = @($config.arguments) + @('--pai', '--cwd', $directory.FullName)
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $config.executable
  $start.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
  $start.WorkingDirectory = $directory.FullName
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  # Shells started by Electron sometimes inherit this, which would run the
  # desktop executable as Node instead of opening the requested window.
  $start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
  $process = [System.Diagnostics.Process]::Start($start)
  $process.Dispose()
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
