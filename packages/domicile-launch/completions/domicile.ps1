# Tab completion for `domicile` in PowerShell, from
# `domicile completions powershell`. `domicile completions --complete` says
# what can go where the cursor is.
Register-ArgumentCompleter -Native -CommandName domicile -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $before = @($commandAst.CommandElements |
        Select-Object -Skip 1 |
        Where-Object { $_.Extent.EndOffset -lt $cursorPosition } |
        ForEach-Object { $_.ToString() })
    $said = @(& domicile completions "--complete=$wordToComplete" @before 2>$null)
    if ($said.Count -eq 0) { return }
    switch ($said[0]) {
        'files' { return }
        'directories' {
            Get-ChildItem -Directory -Path "$wordToComplete*" -ErrorAction SilentlyContinue |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ProviderContainer', $_.Name) }
        }
        'values' {
            $said | Select-Object -Skip 1 | ForEach-Object {
                $value, $about = $_ -split "`t", 2
                if (-not $about) { $about = $value }
                [System.Management.Automation.CompletionResult]::new($value, $value, 'ParameterValue', $about)
            }
        }
    }
}
