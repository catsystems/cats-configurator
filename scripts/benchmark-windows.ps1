param(
  [Parameter(Mandatory = $true)]
  [string]$V1Installer,

  [Parameter(Mandatory = $true)]
  [string]$V2Installer,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [ValidateRange(1, 20)]
  [int]$Runs = 5
)

$ErrorActionPreference = 'Stop'

function Assert-ChildPath {
  param(
    [string]$Path,
    [string]$Parent
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (!$fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside benchmark directory: $fullPath"
  }
  return $fullPath
}

function Wait-ForWindow {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutMilliseconds = 30000
  )

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while ($timer.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "Application exited before opening a window with code $($Process.ExitCode)."
    }
    if ($Process.MainWindowHandle -ne 0) {
      return [int]$timer.ElapsedMilliseconds
    }
    Start-Sleep -Milliseconds 10
  }
  throw "Application did not open a window within $TimeoutMilliseconds ms."
}

function Get-ProcessTree {
  param([int]$RootProcessId)

  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootProcessId)
  do {
    $added = $false
    foreach ($candidate in $all) {
      if ($ids.Contains([int]$candidate.ParentProcessId) -and $ids.Add([int]$candidate.ProcessId)) {
        $added = $true
      }
    }
  } while ($added)

  return @(
    foreach ($id in $ids) {
      Get-Process -Id $id -ErrorAction SilentlyContinue
    }
  )
}

function Stop-ProcessTree {
  param([int]$RootProcessId)

  $tree = @(Get-ProcessTree -RootProcessId $RootProcessId)
  $root = $tree | Where-Object Id -eq $RootProcessId | Select-Object -First 1
  if ($root) {
    [void]$root.CloseMainWindow()
    try {
      Wait-Process -Id $RootProcessId -Timeout 5 -ErrorAction Stop
    } catch {
      Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  $tree |
    Where-Object Id -ne $RootProcessId |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Invoke-OneBenchmark {
  param(
    [string]$Name,
    [string]$Installer,
    [string]$InstallDirectory,
    [int]$Run
  )

  $installTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $installerProcess = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$InstallDirectory") -PassThru -Wait
  $installTimer.Stop()
  if ($installerProcess.ExitCode -ne 0) {
    throw "$Name installer exited with code $($installerProcess.ExitCode)."
  }

  $files = @(Get-ChildItem -LiteralPath $InstallDirectory -File -Recurse)
  $application = $files |
    Where-Object { $_.Extension -eq '.exe' -and $_.Name -notmatch 'uninstall' } |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if (!$application) {
    throw "Could not locate the installed $Name executable."
  }

  $env:CATS_FAKE_SERIAL = '1'
  $appProcess = Start-Process -FilePath $application.FullName -PassThru
  try {
    $startupMilliseconds = Wait-ForWindow -Process $appProcess
    Start-Sleep -Seconds 3
    $processTree = @(Get-ProcessTree -RootProcessId $appProcess.Id)
    $workingSetBytes = ($processTree | Measure-Object WorkingSet64 -Sum).Sum
    $privateMemoryBytes = ($processTree | Measure-Object PrivateMemorySize64 -Sum).Sum
  } finally {
    Stop-ProcessTree -RootProcessId $appProcess.Id
    Remove-Item Env:CATS_FAKE_SERIAL -ErrorAction SilentlyContinue
  }

  $uninstaller = Get-ChildItem -LiteralPath $InstallDirectory -File |
    Where-Object Name -Match 'uninstall.*\.exe$' |
    Select-Object -First 1
  if (!$uninstaller) {
    throw "Could not locate the $Name uninstaller."
  }

  $uninstallTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $uninstallerProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -PassThru -Wait
  $uninstallTimer.Stop()
  if ($uninstallerProcess.ExitCode -ne 0) {
    throw "$Name uninstaller exited with code $($uninstallerProcess.ExitCode)."
  }

  [pscustomobject]@{
    name = $Name
    run = $Run
    installerBytes = (Get-Item -LiteralPath $Installer).Length
    installMilliseconds = [int]$installTimer.ElapsedMilliseconds
    installedBytes = [long](($files | Measure-Object Length -Sum).Sum)
    installedFileCount = $files.Count
    startupToWindowMilliseconds = $startupMilliseconds
    sampleDelayMilliseconds = 3000
    processCount = $processTree.Count
    workingSetBytes = [long]$workingSetBytes
    privateMemoryBytes = [long]$privateMemoryBytes
    uninstallMilliseconds = [int]$uninstallTimer.ElapsedMilliseconds
  }
}

$resolvedV1 = (Resolve-Path -LiteralPath $V1Installer).Path
$resolvedV2 = (Resolve-Path -LiteralPath $V2Installer).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$benchmarkRoot = Join-Path ([System.IO.Path]::GetTempPath()) "cats-configurator-benchmark-$PID"
$benchmarkRoot = Assert-ChildPath -Path $benchmarkRoot -Parent ([System.IO.Path]::GetTempPath())
[void](New-Item -ItemType Directory -Path $benchmarkRoot)

$samples = [System.Collections.Generic.List[object]]::new()
try {
  for ($run = 1; $run -le $Runs; $run += 1) {
    $definitions = @(
      @{ Name = 'V1'; Installer = $resolvedV1 },
      @{ Name = 'V2'; Installer = $resolvedV2 }
    )
    if ($run % 2 -eq 0) {
      [array]::Reverse($definitions)
    }

    foreach ($definition in $definitions) {
      $installDirectory = Join-Path $benchmarkRoot "$($definition.Name)-$run"
      [void]$samples.Add((Invoke-OneBenchmark -Name $definition.Name -Installer $definition.Installer -InstallDirectory $installDirectory -Run $run))
      Write-Output "Completed $($definition.Name) run $run of $Runs."
    }
  }

  $result = [pscustomobject]@{
    measuredAt = (Get-Date).ToUniversalTime().ToString('o')
    machine = [pscustomobject]@{
      os = (Get-CimInstance Win32_OperatingSystem).Caption
      osVersion = [System.Environment]::OSVersion.VersionString
      processor = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
      logicalProcessors = [System.Environment]::ProcessorCount
      totalMemoryBytes = [long](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
      webViewRuntimeExcludedFromInstalledSize = $true
    }
    methodology = [pscustomobject]@{
      runs = $Runs
      order = 'Alternating V1/V2; odd rounds V1 first, even rounds V2 first'
      install = 'NSIS silent install to a unique temporary directory'
      startup = 'Process launch until the root process exposes a main window handle'
      memory = 'Total process-tree memory three seconds after the window appears, using fake serial for comparable device isolation'
      uninstall = 'NSIS silent uninstall process duration'
    }
    artifacts = [pscustomobject]@{
      v1 = $resolvedV1
      v2 = $resolvedV2
    }
    samples = $samples
  }

  $outputDirectory = Split-Path -Parent $resolvedOutput
  if ($outputDirectory) {
    [void](New-Item -ItemType Directory -Path $outputDirectory -Force)
  }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
  Write-Output "Saved benchmark samples to $resolvedOutput"
} finally {
  $safeRoot = Assert-ChildPath -Path $benchmarkRoot -Parent ([System.IO.Path]::GetTempPath())
  if (Test-Path -LiteralPath $safeRoot) {
    Remove-Item -LiteralPath $safeRoot -Recurse -Force
  }
}
