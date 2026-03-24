Add-Type -AssemblyName System.Drawing

function New-PolyTASIcon {
    param([int]$Size, [string]$OutputPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Dark background
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 7, 7, 13))
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)

    # Surface layer (slightly lighter)
    $sfBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 17, 17, 32))
    $margin  = [int]($Size * 0.04)
    $g.FillRectangle($sfBrush, $margin, $margin, $Size - $margin*2, $Size - $margin*2)

    # Yellow accent bar at bottom (~15% height)
    $barH    = [Math]::Max(2, [int]($Size * 0.15))
    $yellow  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 214, 10))
    $g.FillRectangle($yellow, 0, $Size - $barH, $Size, $barH)

    # "PT" text centred in the upper 85%
    $fontSize = [float]($Size * 0.42)
    $font  = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf    = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size - $barH)
    $g.DrawString("PT", $font, $yellow, $textRect, $sf)

    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $font.Dispose(); $g.Dispose(); $bmp.Dispose()
    $bgBrush.Dispose(); $sfBrush.Dispose(); $yellow.Dispose()

    Write-Host "  Created: $OutputPath ($Size x $Size)"
}

$iconsDir = Join-Path $PSScriptRoot "icons"

foreach ($size in @(16, 32, 48, 128)) {
    New-PolyTASIcon -Size $size -OutputPath (Join-Path $iconsDir "icon$size.png")
}

Write-Host ""
Write-Host "All icons generated. Reload the extension in chrome://extensions" -ForegroundColor Green
