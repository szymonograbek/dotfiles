set -g __aw_workspace_root "$HOME/dev/agent-workspaces"
set -g __aw_state_root "$HOME/.local/state/aw"

function __aw_usage
    echo "Usage:"
    echo "  aw create <name> [prompt] [--from <revision>]"
    echo "  aw list"
    echo "  aw open <name>"
    echo "  aw remove [name]"
end

function __aw_state_file_for_current_workspace
    set -l workspace_root (jj root 2>/dev/null)
    if test -z "$workspace_root"
        echo "aw: cannot detect the current jj workspace" >&2
        return 1
    end

    set workspace_root (realpath "$workspace_root")
    if test -d "$__aw_state_root"
        for file in (find "$__aw_state_root" -type f -name '*.json' 2>/dev/null)
            set -l registered_path (jq -r '.path // empty' "$file" 2>/dev/null)
            if test -n "$registered_path"; and test -e "$registered_path"; and test (realpath "$registered_path") = "$workspace_root"
                echo "$file"
                return 0
            end
        end
    end

    echo "aw: the current jj workspace is not managed by aw" >&2
    return 1
end

function __aw_state_file_for_name --argument-names name
    set -l matches

    if test -d "$__aw_state_root"
        for file in (find "$__aw_state_root" -type f -name '*.json' 2>/dev/null)
            if test (jq -r '.name // empty' "$file" 2>/dev/null) = "$name"
                set -a matches "$file"
            end
        end
    end

    if test (count $matches) -eq 0
        echo "aw: workspace '$name' is not registered" >&2
        return 1
    end

    if test (count $matches) -gt 1
        echo "aw: workspace name '$name' is ambiguous:" >&2
        for file in $matches
            jq -r '"  \(.repositoryRoot) -> \(.path)"' "$file" >&2
        end
        return 1
    end

    echo "$matches[1]"
end

function __aw_write_state --argument-names state_file name repository_root path base herdr_workspace_id
    mkdir -p (dirname "$state_file"); or return 1

    set -l temporary_file (mktemp "$state_file.XXXXXX"); or return 1
    jq -n \
        --arg name "$name" \
        --arg repositoryRoot "$repository_root" \
        --arg path "$path" \
        --arg base "$base" \
        --arg herdrWorkspaceId "$herdr_workspace_id" \
        '{name: $name, repositoryRoot: $repositoryRoot, path: $path, base: $base, herdrWorkspaceId: $herdrWorkspaceId}' \
        >"$temporary_file"
    or begin
        rm -f "$temporary_file"
        return 1
    end

    mv "$temporary_file" "$state_file"
end

function __aw_copy_environment_files --argument-names source_path destination_path
    set -l environment_files (find "$source_path" \
        ! -path "$source_path" -type d -prune -o \
        -type f -name '.env.*' -print)
    or begin
        echo "aw: failed to find environment files in $source_path" >&2
        return 1
    end

    for source_file in $environment_files
        echo "==> Copying "(basename "$source_file")
        cp -p "$source_file" "$destination_path"; or begin
            echo "aw: failed to copy environment file: $source_file" >&2
            return 1
        end
    end
end

function __aw_detect_package_manager --argument-names path
    set -l package_json "$path/package.json"
    if not test -f "$package_json"
        echo "aw: no package.json found in $path" >&2
        return 1
    end

    set -l declared (jq -r '.packageManager // empty' "$package_json" 2>/dev/null)
    if test -n "$declared"
        set -l parts (string split -m 1 '@' -- "$declared")
        switch "$parts[1]"
            case bun pnpm yarn npm
                echo "$parts[1]"
                return 0
            case '*'
                echo "aw: unsupported packageManager '$declared'" >&2
                return 1
        end
    end

    set -l detected
    if test -f "$path/bun.lock"; or test -f "$path/bun.lockb"
        set -a detected bun
    end
    if test -f "$path/pnpm-lock.yaml"
        set -a detected pnpm
    end
    if test -f "$path/yarn.lock"
        set -a detected yarn
    end
    if test -f "$path/package-lock.json"; or test -f "$path/npm-shrinkwrap.json"
        set -a detected npm
    end

    if test (count $detected) -eq 1
        echo "$detected[1]"
        return 0
    end

    if test (count $detected) -eq 0
        echo "aw: cannot detect a package manager" >&2
    else
        echo "aw: ambiguous package managers: "(string join ', ' $detected) >&2
    end
    return 1
end

function __aw_is_react_native --argument-names path
    test -f "$path/package.json"; and jq -e '
        ((.dependencies // {}) + (.devDependencies // {}))
        | has("react-native") or has("expo")
    ' "$path/package.json" >/dev/null 2>&1
end

function __aw_create_herdr_workspace --argument-names name path initial_prompt
    set -l response (herdr workspace create --cwd "$path" --label "$name" --focus)
    or begin
        echo "aw: Herdr workspace creation failed" >&2
        return 1
    end

    set -l workspace_id (printf '%s\n' "$response" | jq -er '.result.workspace.workspace_id' 2>/dev/null)
    set -l root_pane_id (printf '%s\n' "$response" | jq -er '.result.root_pane.pane_id' 2>/dev/null)
    if test -z "$workspace_id"; or test -z "$root_pane_id"
        echo "aw: could not read the Herdr workspace or root pane ID" >&2
        return 1
    end

    set -l pi_command pi
    if test -n "$initial_prompt"
        set pi_command "pi "(string escape -- "$initial_prompt")
    end

    herdr pane run "$root_pane_id" "$pi_command" >/dev/null
    or begin
        echo "aw: Herdr workspace created, but Pi failed to start" >&2
        return 1
    end

    echo "$workspace_id"
end

function __aw_create
    if test (count $argv) -lt 1
        __aw_usage >&2
        return 2
    end

    set -l name "$argv[1]"
    set -l base 'trunk()'
    set -l initial_prompt
    set -l index 2

    while test $index -le (count $argv)
        switch "$argv[$index]"
            case --from
                set index (math $index + 1)
                if test $index -gt (count $argv)
                    echo "aw: --from requires a revision" >&2
                    return 2
                end
                set base "$argv[$index]"
            case '*'
                if set -q initial_prompt[1]
                    echo "aw: only one initial prompt is supported" >&2
                    return 2
                end
                set initial_prompt "$argv[$index]"
        end
        set index (math $index + 1)
    end

    set -l name_segments (string split '/' -- "$name")
    if test (count $name_segments) -eq 0
        echo "aw: workspace name cannot be empty" >&2
        return 2
    end
    for segment in $name_segments
        if not string match -qr '^[A-Za-z0-9][A-Za-z0-9._-]*$' -- "$segment"
            echo "aw: each slash-separated name segment must start with a letter or number and contain only letters, numbers, dots, underscores, and hyphens" >&2
            return 2
        end
    end

    set -l repository_root (jj root 2>/dev/null)
    if test -z "$repository_root"
        echo "aw: run this command from a jj repository" >&2
        return 1
    end

    set -l repository_name (basename "$repository_root")
    set -l filesystem_name (string replace -a '/' '-' -- "$name")
    set -l path "$__aw_workspace_root/$repository_name/$filesystem_name"
    set -l state_file "$__aw_state_root/$repository_name/$filesystem_name.json"

    if test -e "$path"; or test -e "$state_file"
        echo "aw: workspace '$name' already exists at $path" >&2
        return 1
    end

    mkdir -p (dirname "$path"); or return 1

    echo "==> Creating jj workspace '$name' from $base"
    jj -R "$repository_root" workspace add "$path" \
        --name "$name" \
        --revision "$base" \
        --message "$name"
    or return 1

    set path (realpath "$path")
    __aw_copy_environment_files "$repository_root" "$path"; or begin
        echo "aw: workspace preserved at $path" >&2
        return 1
    end

    __aw_write_state "$state_file" "$name" "$repository_root" "$path" "$base" ""
    or begin
        echo "aw: workspace created, but state could not be saved: $path" >&2
        return 1
    end

    set -l package_manager (__aw_detect_package_manager "$path")
    or begin
        echo "aw: workspace preserved at $path" >&2
        return 1
    end

    echo "==> Installing dependencies with $package_manager"
    pushd "$path" >/dev/null
    command "$package_manager" install
    set -l install_status $status
    popd >/dev/null

    if test $install_status -ne 0
        echo "aw: dependency installation failed; workspace preserved at $path" >&2
        return $install_status
    end

    echo "==> Creating Herdr workspace"
    set -l herdr_workspace_id (__aw_create_herdr_workspace "$name" "$path" "$initial_prompt")
    or begin
        echo "aw: jj workspace preserved at $path" >&2
        return 1
    end

    __aw_write_state "$state_file" "$name" "$repository_root" "$path" "$base" "$herdr_workspace_id"
    or return 1

    echo "Created $path"
end

function __aw_list
    set -l state_files
    if test -d "$__aw_state_root"
        set state_files (find "$__aw_state_root" -type f -name '*.json' 2>/dev/null | sort)
    end

    if test (count $state_files) -eq 0
        echo "No agent workspaces"
        return 0
    end

    set -l herdr_response (herdr workspace list 2>/dev/null)

    printf '%-20s %-18s %-16s %-10s %s\n' NAME REPOSITORY BASE HERDR PATH
    for state_file in $state_files
        set -l name (jq -r '.name' "$state_file")
        set -l repository_root (jq -r '.repositoryRoot' "$state_file")
        set -l base (jq -r '.base' "$state_file")
        set -l path (jq -r '.path' "$state_file")
        set -l herdr_workspace_id (jq -r '.herdrWorkspaceId // empty' "$state_file")
        set -l herdr_status missing

        if test -n "$herdr_workspace_id"; and printf '%s\n' "$herdr_response" | jq -e --arg id "$herdr_workspace_id" '
            .result.workspaces | any(.workspace_id == $id)
        ' >/dev/null 2>&1
            set herdr_status active
        end

        set -l display_path (string replace "$HOME" '~' "$path")
        printf '%-20s %-18s %-16s %-10s %s\n' \
            "$name" (basename "$repository_root") "$base" "$herdr_status" "$display_path"
    end
end

function __aw_open --argument-names name
    if test -z "$name"
        __aw_usage >&2
        return 2
    end

    set -l state_file (__aw_state_file_for_name "$name"); or return 1
    set -l path (jq -r '.path' "$state_file")
    set -l herdr_workspace_id (jq -r '.herdrWorkspaceId // empty' "$state_file")

    if not test -d "$path"
        echo "aw: workspace directory is missing: $path" >&2
        return 1
    end

    if test -n "$herdr_workspace_id"; and herdr workspace get "$herdr_workspace_id" >/dev/null 2>&1
        herdr workspace focus "$herdr_workspace_id" >/dev/null
        return $status
    end

    echo "==> Recreating Herdr workspace"
    set herdr_workspace_id (__aw_create_herdr_workspace "$name" "$path"); or return 1

    set -l temporary_file (mktemp "$state_file.XXXXXX"); or return 1
    jq --arg id "$herdr_workspace_id" '.herdrWorkspaceId = $id' "$state_file" >"$temporary_file"
    and mv "$temporary_file" "$state_file"
    or begin
        rm -f "$temporary_file"
        return 1
    end

end

function __aw_remove --argument-names name
    set -l state_file
    if test -n "$name"
        set state_file (__aw_state_file_for_name "$name"); or return 1
    else
        set state_file (__aw_state_file_for_current_workspace); or return 1
        set name (jq -r '.name' "$state_file")
    end

    set -l repository_root (jq -r '.repositoryRoot' "$state_file")
    set -l path (jq -r '.path' "$state_file")
    set -l herdr_workspace_id (jq -r '.herdrWorkspaceId // empty' "$state_file")
    set -l current_directory (pwd -P)
    set -l canonical_path "$path"
    if test -e "$path"
        set canonical_path (realpath "$path")
    end
    set -l removing_current_workspace false
    if test "$current_directory" = "$canonical_path"; or string match -q "$canonical_path/*" -- "$current_directory"
        set removing_current_workspace true
    end

    set -l canonical_workspace_root "$__aw_workspace_root"
    if test -e "$__aw_workspace_root"
        set canonical_workspace_root (realpath "$__aw_workspace_root")
    end
    if not string match -q "$canonical_workspace_root/*" -- "$canonical_path"
        echo "aw: refusing to remove path outside $__aw_workspace_root: $path" >&2
        return 1
    end

    echo "Workspace: $name"
    echo "Path:      $path"
    if test -d "$path"
        jj -R "$path" status
    end

    read --local --prompt-str "Remove this workspace and its runtime? [y/N] " confirmation
    if not string match -qi 'y' -- "$confirmation"; and not string match -qi 'yes' -- "$confirmation"
        echo "Cancelled"
        return 1
    end

    if test "$removing_current_workspace" = false; and test -n "$herdr_workspace_id"
        herdr workspace close "$herdr_workspace_id" >/dev/null 2>&1; or true
    end

    if test -d "$path"; and __aw_is_react_native "$path"
        pushd "$path" >/dev/null
        npx rn-iso device --json >/dev/null 2>&1
        set -l has_assignment $status
        popd >/dev/null

        if test $has_assignment -eq 0
            echo "==> Shutting down rn-iso runtime"
            npx rn-iso shutdown "$path" -y
            or begin
                echo "aw: rn-iso shutdown failed; workspace was not removed" >&2
                return 1
            end
        end
    end

    if test "$removing_current_workspace" = true
        cd "$repository_root"; or return 1
    end

    echo "==> Forgetting jj workspace"
    jj -R "$repository_root" workspace forget "$name"; or return 1

    rm -rf -- "$path"; or return 1

    if __aw_is_react_native "$repository_root"
        pushd "$repository_root" >/dev/null
        npx rn-iso prune >/dev/null 2>&1; or true
        popd >/dev/null
    end

    rm -f "$state_file"
    rmdir (dirname "$state_file") 2>/dev/null; or true
    echo "Removed $name"

    if test "$removing_current_workspace" = true; and test -n "$herdr_workspace_id"
        herdr workspace close "$herdr_workspace_id" >/dev/null 2>&1; or true
    end
end

function aw --description 'Manage isolated jj, Herdr, Pi, and React Native workspaces'
    if test (count $argv) -eq 0
        __aw_usage
        return 2
    end

    set -l command "$argv[1]"
    set -e argv[1]

    switch "$command"
        case create
            __aw_create $argv
        case list
            if test (count $argv) -ne 0
                __aw_usage >&2
                return 2
            end
            __aw_list
        case open
            if test (count $argv) -ne 1
                __aw_usage >&2
                return 2
            end
            __aw_open "$argv[1]"
        case remove
            if test (count $argv) -gt 1
                __aw_usage >&2
                return 2
            end
            __aw_remove $argv
        case help --help -h
            __aw_usage
        case '*'
            echo "aw: unknown command '$command'" >&2
            __aw_usage >&2
            return 2
    end
end
