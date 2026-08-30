param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [string]$VoiceName = '',
  [ValidateRange(-10, 10)][int]$Rate = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($VoiceName.Length -gt 0) {
    $speech.SelectVoice($VoiceName)
  }
  $speech.Rate = $Rate
  $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
  $speech.SetOutputToWaveFile($OutputFile)
  $speech.Speak($text)
} finally {
  $speech.Dispose()
}

