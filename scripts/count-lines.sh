#!/bin/bash

# 项目代码统计脚本
# 区分源代码和配置文件

echo "=========================================="
echo "         项目代码统计"
echo "=========================================="
echo ""

# 统计函数
count_lines() {
    local ext=$1
    local path=$2
    local exclude_dirs="node_modules|.next|target|dist|build|.git"
    find "$path" -type f \( -name "*$ext" \) 2>/dev/null | grep -v -E "($exclude_dirs)" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'
}

# 源代码文件扩展名
declare -A code_exts=(
    ["TypeScript"]="*.ts"
    ["TSX"]="*.tsx"
    ["JavaScript"]="*.js"
    ["JSX"]="*.jsx"
    ["Rust"]="*.rs"
    ["CSS"]="*.css"
    ["SCSS"]="*.scss"
)

# 配置文件扩展名
declare -A config_exts=(
    ["JSON"]="*.json"
    ["YAML"]="*.yaml"
    ["YML"]="*.yml"
    ["TOML"]="*.toml"
    ["XML"]="*.xml"
    ["HTML"]="*.html"
    ["Markdown"]="*.md"
)

# 源代码目录
src_dirs=("src" "src-next" "src-tauri/src")

# 配置文件
config_files=("package.json" "tsconfig.json" "tsconfig.node.json" "next.config.ts" "next.config.js" "tailwind.config.ts" "postcss.config.js" "rustfmt.toml" ".editorconfig")

echo "📁 源代码统计 (src, src-next, src-tauri/src)"
echo "------------------------------------------"

total_code=0
total_config=0

# 统计各类源代码
for ext in "${!code_exts[@]}"; do
    pattern="${code_exts[$ext]}"
    count=$(find src src-next src-tauri/src -type f \( -name "$pattern" \) 2>/dev/null | grep -v -E "(node_modules|\.next|target)" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    if [ -n "$count" ] && [ "$count" -gt 0 ]; then
        printf "  %-15s %s: %5d 行\n" "$ext" "$pattern" "$count"
        total_code=$((total_code + count))
    fi
done

echo ""
echo "📄 配置文件统计"
echo "------------------------------------------"

# 统计配置文件
for file in "${config_files[@]}"; do
    if [ -f "$file" ]; then
        count=$(wc -l < "$file" 2>/dev/null)
        printf "  %-25s: %5d 行\n" "$file" "$count"
        total_config=$((total_config + count))
    fi
done

# 统计 Rust 配置文件
if [ -f "src-tauri/Cargo.toml" ]; then
    count=$(wc -l < "src-tauri/Cargo.toml" 2>/dev/null)
    printf "  %-25s: %5d 行\n" "src-tauri/Cargo.toml" "$count"
    total_config=$((total_config + count))
fi

if [ -f "src-tauri/tauri.conf.json" ]; then
    count=$(wc -l < "src-tauri/tauri.conf.json" 2>/dev/null)
    printf "  %-25s: %5d 行\n" "src-tauri/tauri.conf.json" "$count"
    total_config=$((total_config + count))
fi

echo ""
echo "=========================================="
printf "  源代码总计:  %d 行\n" "$total_code"
printf "  配置文件总计: %d 行\n" "$total_config"
echo "=========================================="
printf "  总计:        %d 行\n" $((total_code + total_config))
echo ""
