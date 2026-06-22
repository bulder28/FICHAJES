@echo off
chcp 65001 >nul
color 0A
echo ========================================================
echo        UNIFICADOR DE REGISTROS DE FORMACION STULZ
echo ========================================================
echo.
echo Conectando a la carpeta de red SVF...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$folder='\\svf\Procesos\Proyectos_Iker\FICHAJES FORMACIÓN'; $out=Join-Path $folder 'Registro_Maestro_Total.csv'; if(-not (Test-Path $folder)){ Write-Host 'ERROR: No se puede acceder a la carpeta de red. Comprueba tu conexion.' -ForegroundColor Red; exit }; if(Test-Path $out){Remove-Item $out}; $files=Get-ChildItem -Path $folder -Filter *.csv | Where Name -NE 'Registro_Maestro_Total.csv'; if($files.Count -eq 0){Write-Host 'No se encontraron nuevos archivos CSV de las lineas para unificar.' -ForegroundColor Yellow; exit}; $first=$true; foreach($f in $files){ if($first){ Get-Content $f.FullName | Out-File $out -Encoding UTF8; $first=$false } else { Get-Content $f.FullName | Select-Object -Skip 1 | Out-File $out -Encoding UTF8 -Append } }; Write-Host \"¡Exito! Se han unificado $($files.Count) archivos en: $out\" -ForegroundColor Green"

echo.
echo Proceso finalizado. Revisa la carpeta SVF.
pause
