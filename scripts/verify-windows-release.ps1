[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArtifactPath,
  [string]$ExpectedPublisher,
  [string]$ManifestPath,
  [switch]$AllowUnsignedDevelopment
)

$ErrorActionPreference = 'Stop'
$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$item = Get-Item -LiteralPath $artifact
$signature = Get-AuthenticodeSignature -LiteralPath $artifact

if ($AllowUnsignedDevelopment) {
  if ($signature.Status -notin @('Valid', 'NotSigned')) { throw "Development artifact signature state is unsafe: $($signature.Status)." }
} else {
  if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) { throw 'ExpectedPublisher is required for production verification.' }
  if ($signature.Status -ne 'Valid') { throw "Production artifact signature is not valid: $($signature.Status)." }
  if ($signature.SignerCertificate.Subject -notlike "*$ExpectedPublisher*") { throw "Publisher mismatch: $($signature.SignerCertificate.Subject)." }
  if ($null -eq $signature.TimeStamperCertificate) { throw 'Production artifact is not timestamped.' }
}

$stream = [IO.File]::OpenRead($artifact)
try {
  $reader = [IO.BinaryReader]::new($stream)
  if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Artifact is not a Windows PE executable.' }
  $stream.Position = 0x3C
  $peOffset = $reader.ReadInt32()
  $stream.Position = $peOffset
  if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Artifact PE signature is invalid.' }
  $machine = $reader.ReadUInt16()
  $architectureEvidence = if ($machine -eq 0x8664) { 'x64-pe' } elseif ($machine -eq 0x014C -and $item.Name -match '-x64\.exe$') { 'nsis-x86-bootstrapper-x64-payload' } else { throw "Artifact architecture is not the approved x64 package: 0x$($machine.ToString('X4'))." }
} finally {
  if ($null -ne $reader) { $reader.Dispose() }
  $stream.Dispose()
}

$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
$builderConfig = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\electron-builder.yml')
if ($builderConfig -notmatch 'perMachine:\s*false' -or $builderConfig -notmatch 'allowElevation:\s*false' -or $builderConfig -notmatch 'arch:\s*\[x64\]') {
  throw 'Installer configuration does not prove per-user, no-normal-elevation, x64 scope.'
}

$manifestVerified = $false
if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
  $manifest = Get-Content -Raw -LiteralPath (Resolve-Path -LiteralPath $ManifestPath) | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.architecture -ne 'x64') { throw 'Update manifest schema or architecture is invalid.' }
  if ($manifest.artifactSha256 -and $manifest.artifactSha256.ToLowerInvariant() -ne $hash) { throw 'Update manifest artifact hash does not match.' }
  if ($manifest.artifactUrl -notmatch '^https://') { throw 'Update manifest artifact URL must use HTTPS.' }
  $manifestVerified = $true
}

[pscustomobject]@{
  artifact = $item.Name
  bytes = $item.Length
  architecture = $architectureEvidence
  sha256 = $hash
  signatureStatus = [string]$signature.Status
  publisher = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  timestamped = $null -ne $signature.TimeStamperCertificate
  installScope = 'per-user'
  normalElevation = $false
  manifestVerified = $manifestVerified
  productionReady = $signature.Status -eq 'Valid' -and $null -ne $signature.TimeStamperCertificate
} | ConvertTo-Json -Depth 3
