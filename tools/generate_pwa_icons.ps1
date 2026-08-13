Add-Type -AssemblyName System.Drawing

$source = Join-Path $PSScriptRoot "..\static\icons"

function New-ToolboxIcon([int]$size, [string]$filename) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#17231d"))

    $margin = [int]($size * 0.18)
    $orange = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#e76225"))
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#fffefa"))
    $graphics.FillRectangle($orange, $margin, $margin, $size - (2 * $margin), $size - (2 * $margin))

    $font = New-Object System.Drawing.Font("Georgia", ($size * 0.54), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString("T", $font, $white, [System.Drawing.RectangleF]::new(0, 0, $size, $size), $format)

    $bitmap.Save((Join-Path $source $filename), [System.Drawing.Imaging.ImageFormat]::Png)
    $format.Dispose()
    $font.Dispose()
    $white.Dispose()
    $orange.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

New-ToolboxIcon 180 "toolbox-180.png"
New-ToolboxIcon 192 "toolbox-192.png"
New-ToolboxIcon 512 "toolbox-512.png"
