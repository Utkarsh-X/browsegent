param(
    [switch]$Once
)

# Ensure console encoding
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.CursorVisible = $false } catch {}

$TOTAL_IMAGE_GB = 67.58
$TOTAL_IMAGE_BYTES = 67.58 * 1GB
$INGEST_BASE = "/mnt/docker-desktop-disk/data/desktop-containerd/daemon/io.containerd.content.v1.content/ingest"
$BLOBS_BASE = "/mnt/docker-desktop-disk/data/desktop-containerd/daemon/io.containerd.content.v1.content/blobs"
$VHDX_PATH = "G:\Docker\wsl\DockerDesktopWSL\disk\docker_data.vhdx"

function Get-Bar([double]$pct, [int]$width = 24) {
    if ($pct -lt 0) { $pct = 0 }
    if ($pct -gt 100) { $pct = 100 }
    $filled = [math]::Round(($pct / 100) * $width)
    $empty = $width - $filled
    $fillStr = if ($filled -gt 0) { "#" * $filled } else { "" }
    $emptyStr = if ($empty -gt 0) { "-" * $empty } else { "" }
    return "[$fillStr$emptyStr] $($pct.ToString('0.0'))%"
}

function Format-Eta([double]$seconds) {
    if ($seconds -le 0 -or [double]::IsInfinity($seconds) -or [double]::IsNaN($seconds)) { return "--:--:--" }
    $ts = [TimeSpan]::FromSeconds($seconds)
    if ($ts.TotalHours -ge 1) {
        return "$([math]::Floor($ts.TotalHours))h $($ts.Minutes)m $($ts.Seconds)s"
    }
    return "$($ts.Minutes)m $($ts.Seconds)s"
}

Clear-Host

$speedSamples = [System.Collections.Generic.Queue[double]]::new()
$prevStats = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 50000000 }
$prevTime = Get-Date

try {
    do {
        Start-Sleep -Milliseconds 1500
        $currTime = Get-Date
        $dt = ($currTime - $prevTime).TotalSeconds
        if ($dt -le 0) { $dt = 1 }

        # Network speed
        $currStats = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 50000000 }
        $activeAdapterName = "Network"
        $maxDiff = 0

        foreach ($cur in $currStats) {
            $prev = $prevStats | Where-Object { $_.Name -eq $cur.Name }
            if ($prev) {
                $diff = $cur.ReceivedBytes - $prev.ReceivedBytes
                if ($diff -gt $maxDiff) {
                    $maxDiff = $diff
                    $activeAdapterName = $cur.Name
                }
            }
        }
        $prevStats = $currStats
        $prevTime = $currTime

        $instantSpeedMBs = ($maxDiff / $dt) / 1MB
        $speedSamples.Enqueue($instantSpeedMBs)
        if ($speedSamples.Count -gt 5) { $null = $speedSamples.Dequeue() }
        $avgSpeedMBs = ($speedSamples | Measure-Object -Average).Average
        if ($avgSpeedMBs -lt 0.01) { $avgSpeedMBs = $instantSpeedMBs }

        # Exact disk-level metrics from containerd
        $activeDir = (wsl -d docker-desktop ls -t $INGEST_BASE 2>$null | Select-Object -First 1)
        $layerCurBytes = 0
        $layerTotBytes = 0
        $layerPct = 0

        if ($activeDir) {
            $layerCurBytes = [int64](wsl -d docker-desktop stat -c %s "$INGEST_BASE/$activeDir/data" 2>$null)
            $layerTotBytes = [int64](wsl -d docker-desktop cat "$INGEST_BASE/$activeDir/total" 2>$null)
            if ($layerTotBytes -gt 0) {
                $layerPct = [math]::Round(($layerCurBytes / $layerTotBytes) * 100, 1)
            }
        }

        $blobsKB = [int64](wsl -d docker-desktop du -sk $BLOBS_BASE 2>$null | ForEach-Object { ($_ -split '\s+')[0] })
        $totalIngestedBytes = ($blobsKB * 1024) + $layerCurBytes
        $overallPct = [math]::Round(($totalIngestedBytes / $TOTAL_IMAGE_BYTES) * 100, 1)
        if ($overallPct -gt 100) { $overallPct = 100 }

        $remainingBytes = $TOTAL_IMAGE_BYTES - $totalIngestedBytes
        if ($remainingBytes -lt 0) { $remainingBytes = 0 }
        $etaSeconds = if ($avgSpeedMBs -gt 0.05) { ($remainingBytes / 1MB) / $avgSpeedMBs } else { 0 }

        # Host H: storage
        $vhdxSizeGB = if (Test-Path $VHDX_PATH) { [math]::Round((Get-Item $VHDX_PATH).Length / 1GB, 2) } else { 0 }
        $hDrive = Get-PSDrive -Name H -ErrorAction SilentlyContinue
        $hFreeGB = if ($hDrive) { [math]::Round($hDrive.Free / 1GB, 2) } else { 0 }

        # Container status
        $containerUp = docker ps --filter "name=^/shopping$" --format "{{.Status}}" 2>$null

        # In-place repositioning
        try { [Console]::SetCursorPosition(0, 0) } catch { Clear-Host }

        $WIDTH = 58
        function Line([string]$title, [string]$val, [string]$tCol="Gray", [string]$vCol="White") {
            $left = "  $title".PadRight(20)
            $right = "$val".PadRight($WIDTH - 22)
            Write-Host "| " -NoNewline -ForegroundColor DarkGray
            Write-Host $left -NoNewline -ForegroundColor $tCol
            Write-Host $right -NoNewline -ForegroundColor $vCol
            Write-Host " |" -ForegroundColor DarkGray
        }

        function Header([string]$text, [string]$col="Cyan") {
            $pad = "  $text".PadRight($WIDTH - 2)
            Write-Host "| " -NoNewline -ForegroundColor DarkGray
            Write-Host $pad -NoNewline -ForegroundColor $col
            Write-Host " |" -ForegroundColor DarkGray
        }

        function Divider() {
            Write-Host ("+" + ("-" * ($WIDTH)) + "+") -ForegroundColor DarkCyan
        }

        $speedColor = if ($avgSpeedMBs -ge 5) { "Green" } elseif ($avgSpeedMBs -ge 1) { "Yellow" } else { "Magenta" }

        Divider
        Header "WEBARENA SHOPPING STACK -- LIVE MONITOR" "Cyan"
        Header "Time: $(Get-Date -Format 'HH:mm:ss')  |  $activeAdapterName  |  CMU Mirror" "DarkGray"
        Divider

        Header "SPEED & TIME" "Yellow"
        Line "Download Speed" "$($avgSpeedMBs.ToString('0.00')) MB/s ($([math]::Round($avgSpeedMBs * 8, 1)) Mbps)" "Gray" $speedColor
        Line "Estimated ETA" "$(Format-Eta $etaSeconds)" "Gray" "White"
        Divider

        Header "REAL INGEST PROGRESS (67.58 GB TOTAL)" "Yellow"
        Header "$(Get-Bar $overallPct 26)" "Green"
        Line "Ingested" "$([math]::Round($totalIngestedBytes / 1GB, 2)) GB / $TOTAL_IMAGE_GB GB ($overallPct%)" "Gray" "White"
        Line "Remaining" "$([math]::Round($remainingBytes / 1GB, 2)) GB" "Gray" "DarkGray"
        Divider

        Header "ACTIVE BASE LAYER (57.18 GB)" "Yellow"
        if ($activeDir) {
            Header "$(Get-Bar $layerPct 26)" "White"
            Line "Written" "$([math]::Round($layerCurBytes / 1GB, 2)) GB / $([math]::Round($layerTotBytes / 1GB, 2)) GB" "Gray" "White"
        } else {
            Header "Committing to Docker..." "DarkGray"
        }
        Divider

        Header "STORAGE (H: DRIVE)" "Yellow"
        Line "VHDX Container" "$vhdxSizeGB GB (Allocated, no growth needed)" "Gray" "White"
        Line "Free Space" "$hFreeGB GB Free" "Gray" "White"
        Divider

        if ($containerUp -match "Up") {
            Header "STATUS: [ONLINE] Container is UP! (:7770)" "Green"
        } else {
            Header "STATUS: [STREAMING] Loading into Docker..." "Magenta"
        }
        Divider
        Write-Host "  [Ctrl+C] Exit Monitor (Transfer runs in background)  " -ForegroundColor DarkGray
    } while (-not $Once)
}
finally {
    try { [Console]::CursorVisible = $true } catch {}
}
