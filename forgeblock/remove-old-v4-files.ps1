# Removes old pages that v7 and v8 replaced. Run from the forgeblock folder.
$old = @(
  'frontend\src\pages\Compare.jsx',
  'frontend\src\pages\MyChecks.jsx',
  'frontend\src\pages\ReviewQueue.jsx',
  'frontend\src\pages\admin\Model.jsx',
  'frontend\src\pages\admin\Reports.jsx',
  'frontend\src\pages\admin\Status.jsx',
  'frontend\src\pages\admin\Performance.jsx'
)
foreach ($f in $old) {
  if (Test-Path $f) { Remove-Item $f; Write-Host "Removed $f" } else { Write-Host "Already gone: $f" }
}
