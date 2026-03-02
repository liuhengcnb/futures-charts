@echo off
chcp 65001 >nul
echo ==========================================
echo   GitHub 仓库完整上传工具
echo ==========================================
echo.

echo [步骤1] 棣查Git状态...
git status
echo.

echo [步骤2] 添加所有文件到Git...
git add .
echo.

echo [步骤3] 提交更改...
git commit -m "添加网站页面文件和配置文件"
if errorlevel 1 (
    echo 没有需要提交的更改
    goto :end
)
echo.

echo [步骤4] 推送到GitHub...
git push origin main
if errorlevel 1 (
    echo 推送失败，    goto :end
)

echo.
echo ==========================================
echo   上传成功！
echo ==========================================
echo.
echo 请在GitHub网页上刷新仓库页面
echo 确认所有文件已上传
echo.

:end
pause