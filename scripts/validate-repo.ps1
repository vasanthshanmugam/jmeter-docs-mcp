#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Validates the repository structure for the Claude, GitHub Copilot, and Codex plugins, agent skills, MCP config, and the MCP server package.

.DESCRIPTION
    1. Claude plugin (.claude-plugin/)          marketplace.json + plugin.json (source of truth)
    2. GitHub Copilot plugin (.github/plugin/)  plugin.json must be an exact copy of the Claude one
    3. Codex plugin (.codex-plugin/ + .agents/plugins/marketplace.json)
    4. Agent skills (skills/*/SKILL.md) with a frontmatter name matching the folder
    5. MCP configuration (.mcp.json) pointing at the npm package built from server/
    6. MCP server package (server/)

    Run this script to verify your changes before submitting a PR.

.EXAMPLE
    ./scripts/validate-repo.ps1
#>

$ErrorActionPreference = "Stop"
$script:hasErrors = $false
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginName = "jmeter-docs"

function Write-ValidationError($message) {
    Write-Host "❌ ERROR: $message" -ForegroundColor Red
    $script:hasErrors = $true
}

function Write-ValidationSuccess($message) {
    Write-Host "✅ $message" -ForegroundColor Green
}

function Write-ValidationHeader($message) {
    Write-Host "`n📋 $message" -ForegroundColor Cyan
    Write-Host ("-" * 50) -ForegroundColor Gray
}

function Test-ValidJson($path) {
    try {
        $null = Get-Content $path -Raw | ConvertFrom-Json
        return $true
    } catch {
        return $false
    }
}

function Test-JsonFile($relativePath) {
    $path = Join-Path $repoRoot $relativePath
    if (-not (Test-Path $path)) {
        Write-ValidationError "Missing: $relativePath"
        return $false
    }
    Write-ValidationSuccess "Found: $relativePath"
    if (-not (Test-ValidJson $path)) {
        Write-ValidationError "Invalid JSON: $relativePath"
        return $false
    }
    Write-ValidationSuccess "Valid JSON: $relativePath"
    return $true
}

# ============================================================================
# 1. Claude plugin
# ============================================================================
Write-ValidationHeader "Validating Claude Plugin (.claude-plugin/)"

$claudeOk = Test-JsonFile ".claude-plugin/plugin.json"
$claudeMarketplaceOk = Test-JsonFile ".claude-plugin/marketplace.json"
$claudePluginJson = Join-Path $repoRoot ".claude-plugin" "plugin.json"

if ($claudeOk) {
    $claudeObj = Get-Content $claudePluginJson -Raw | ConvertFrom-Json
    if ($claudeObj.name -ne $pluginName) {
        Write-ValidationError ".claude-plugin/plugin.json name must be '$pluginName'."
    }
}

if ($claudeMarketplaceOk) {
    $claudeMarketplace = Get-Content (Join-Path $repoRoot ".claude-plugin" "marketplace.json") -Raw | ConvertFrom-Json
    $entry = $claudeMarketplace.plugins | Where-Object { $_.name -eq $pluginName } | Select-Object -First 1
    if ($null -eq $entry) {
        Write-ValidationError "Missing plugin entry '$pluginName' in .claude-plugin/marketplace.json"
    } elseif ($entry.source -ne "./") {
        Write-ValidationError "Claude marketplace entry '$pluginName' must use source './'."
    } else {
        Write-ValidationSuccess "Claude marketplace entry points to ./"
    }
}

# ============================================================================
# 2. GitHub Copilot plugin: exact copy of the Claude plugin.json
# ============================================================================
Write-ValidationHeader "Validating plugin.json sync (.claude-plugin/ and .github/plugin/)"

$githubPluginJson = Join-Path $repoRoot ".github" "plugin" "plugin.json"
if (-not (Test-Path $githubPluginJson)) {
    Write-ValidationError "Missing: .github/plugin/plugin.json"
} elseif (Test-Path $claudePluginJson) {
    if ((Get-Content $claudePluginJson -Raw) -eq (Get-Content $githubPluginJson -Raw)) {
        Write-ValidationSuccess "plugin.json files are in sync"
    } else {
        Write-ValidationError "plugin.json drift detected: copy .claude-plugin/plugin.json (source of truth) to .github/plugin/plugin.json."
    }
}

# ============================================================================
# 3. Codex plugin
# ============================================================================
Write-ValidationHeader "Validating Codex Plugin"

$codexMarketplaceOk = Test-JsonFile ".agents/plugins/marketplace.json"
$codexOk = Test-JsonFile ".codex-plugin/plugin.json"

if ($codexMarketplaceOk) {
    $marketplaceObj = Get-Content (Join-Path $repoRoot ".agents" "plugins" "marketplace.json") -Raw | ConvertFrom-Json
    $entry = $marketplaceObj.plugins | Where-Object { $_.name -eq $pluginName } | Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($marketplaceObj.name)) {
        Write-ValidationError "Codex marketplace root 'name' must be set."
    }
    if ([string]::IsNullOrWhiteSpace($marketplaceObj.interface.displayName)) {
        Write-ValidationError "Codex marketplace interface.displayName must be set."
    }

    if ($null -eq $entry) {
        Write-ValidationError "Missing plugin entry '$pluginName' in .agents/plugins/marketplace.json"
    } else {
        if ($entry.source.source -ne "local") { Write-ValidationError "Codex marketplace entry must use source.source = 'local'." }
        if ($entry.source.path -ne "./") { Write-ValidationError "Codex marketplace entry must use source.path = './'." }
        if ([string]::IsNullOrWhiteSpace($entry.policy.installation)) { Write-ValidationError "Codex marketplace entry is missing policy.installation." }
        if ([string]::IsNullOrWhiteSpace($entry.policy.authentication)) { Write-ValidationError "Codex marketplace entry is missing policy.authentication." }
        if ([string]::IsNullOrWhiteSpace($entry.category)) { Write-ValidationError "Codex marketplace entry is missing category." }
        Write-ValidationSuccess "Codex marketplace entry checked"
    }
}

if ($codexOk -and $claudeOk) {
    $codexObj = Get-Content (Join-Path $repoRoot ".codex-plugin" "plugin.json") -Raw | ConvertFrom-Json
    $syncOk = $true

    foreach ($key in @("name", "description", "version", "homepage", "repository")) {
        if ("$($claudeObj.$key)" -ne "$($codexObj.$key)") {
            Write-ValidationError "Codex plugin.json '$key' differs from .claude-plugin/plugin.json. Expected '$($claudeObj.$key)', got '$($codexObj.$key)'."
            $syncOk = $false
        }
    }
    if ($claudeObj.author.name -ne $codexObj.author.name) {
        Write-ValidationError "Codex plugin.json 'author.name' differs from .claude-plugin/plugin.json."
        $syncOk = $false
    }
    if ((($claudeObj.keywords | Sort-Object) -join ",") -ne (($codexObj.keywords | Sort-Object) -join ",")) {
        Write-ValidationError "Codex plugin.json 'keywords' differ from .claude-plugin/plugin.json."
        $syncOk = $false
    }
    if ($codexObj.skills -ne "./skills/") {
        Write-ValidationError "Codex plugin.json 'skills' must be './skills/'."
        $syncOk = $false
    }
    if ($codexObj.mcpServers -ne "./.mcp.json") {
        Write-ValidationError "Codex plugin.json 'mcpServers' must be './.mcp.json'."
        $syncOk = $false
    }
    if ($syncOk) {
        Write-ValidationSuccess "Codex plugin.json is in sync with source of truth and wired to repo-root assets"
    }
}

# ============================================================================
# 4. Agent skills
# ============================================================================
Write-ValidationHeader "Validating Agent Skills (skills/)"

$skillsDir = Join-Path $repoRoot "skills"
if (-not (Test-Path $skillsDir)) {
    Write-ValidationError "Missing: skills/ directory"
} else {
    $skillFolders = Get-ChildItem -Path $skillsDir -Directory
    if ($skillFolders.Count -eq 0) {
        Write-ValidationError "No skill folders found in skills/"
    }
    foreach ($folder in $skillFolders) {
        $skillMd = Join-Path $folder.FullName "SKILL.md"
        if (-not (Test-Path $skillMd)) {
            Write-ValidationError "Missing: skills/$($folder.Name)/SKILL.md"
            continue
        }
        $content = Get-Content $skillMd -Raw
        $frontmatter = [regex]::Match($content, "(?s)\A---\r?\n(.*?)\r?\n---")
        if (-not $frontmatter.Success) {
            Write-ValidationError "skills/$($folder.Name)/SKILL.md must start with YAML frontmatter."
            continue
        }
        $name = [regex]::Match($frontmatter.Groups[1].Value, "(?m)^name:\s*(.+?)\s*$").Groups[1].Value
        $description = [regex]::Match($frontmatter.Groups[1].Value, "(?m)^description:\s*(.+?)\s*$").Groups[1].Value
        if ($name -ne $folder.Name) {
            Write-ValidationError "skills/$($folder.Name)/SKILL.md frontmatter name '$name' must match the folder name."
        } elseif ([string]::IsNullOrWhiteSpace($description)) {
            Write-ValidationError "skills/$($folder.Name)/SKILL.md is missing a description."
        } else {
            Write-ValidationSuccess "Valid skill: skills/$($folder.Name)"
        }

        foreach ($link in [regex]::Matches($content, "\]\((references/[^)]+)\)")) {
            $target = Join-Path $folder.FullName $link.Groups[1].Value
            if (-not (Test-Path $target)) {
                Write-ValidationError "skills/$($folder.Name)/SKILL.md links to missing file $($link.Groups[1].Value)"
            }
        }
    }
}

# ============================================================================
# 5. MCP configuration
# ============================================================================
Write-ValidationHeader "Validating MCP Configuration (.mcp.json)"

$serverPackageJson = Join-Path $repoRoot "server" "package.json"
if ((Test-JsonFile ".mcp.json") -and (Test-Path $serverPackageJson)) {
    $mcpObj = Get-Content (Join-Path $repoRoot ".mcp.json") -Raw | ConvertFrom-Json
    $serverPkg = Get-Content $serverPackageJson -Raw | ConvertFrom-Json
    $entry = $mcpObj.mcpServers.$pluginName
    if ($null -eq $entry) {
        Write-ValidationError ".mcp.json must define an MCP server named '$pluginName'."
    } elseif (-not ($entry.args | Where-Object { $_ -like "$($serverPkg.name)@*" -or $_ -eq $serverPkg.name })) {
        Write-ValidationError ".mcp.json must launch the npm package '$($serverPkg.name)' built from server/."
    } else {
        Write-ValidationSuccess ".mcp.json launches $($serverPkg.name)"
    }
}

# ============================================================================
# 6. MCP server package
# ============================================================================
Write-ValidationHeader "Validating MCP server (server/)"

if (Test-JsonFile "server/package.json") {
    $serverPkg = Get-Content $serverPackageJson -Raw | ConvertFrom-Json
    if ($claudeOk -and $serverPkg.version -ne $claudeObj.version) {
        Write-ValidationError "server/package.json version '$($serverPkg.version)' must match plugin version '$($claudeObj.version)'."
    } else {
        Write-ValidationSuccess "server/package.json version matches plugin version"
    }
}
$null = Test-JsonFile "server/tsconfig.json"

foreach ($file in @(
    "server/README.md",
    "server/src/index.ts",
    "server/src/server.ts",
    "server/src/docs/library.ts",
    "server/src/docs/html.ts",
    "server/src/docs/search.ts",
    "server/src/jmx/inspect.ts",
    "server/test/unit/html.test.ts",
    "server/test/unit/search.test.ts",
    "server/test/unit/inspect.test.ts"
)) {
    if (Test-Path (Join-Path $repoRoot $file)) {
        Write-ValidationSuccess "Found: $file"
    } else {
        Write-ValidationError "Missing: $file"
    }
}

# ============================================================================
# Summary
# ============================================================================
Write-Host "`n" ("-" * 50) -ForegroundColor Gray
if ($script:hasErrors) {
    Write-Host "❌ Validation FAILED - Please fix the errors above" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ All validations PASSED" -ForegroundColor Green
    exit 0
}
