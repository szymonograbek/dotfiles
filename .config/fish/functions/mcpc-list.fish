function mcpc-list --description 'List saved mcporter credential profiles (optionally filtered by server)'
    if test (count $argv) -gt 1
        echo "usage: mcpc-list [<mcp-name>]" >&2
        return 2
    end

    set -l files
    if test (count $argv) -eq 1
        set files (path filter -f ~/.mcporter/credentials.$argv[1].*.json 2>/dev/null)
    else
        set files (path filter -f ~/.mcporter/credentials.*.*.json 2>/dev/null)
    end

    if test (count $files) -eq 0
        echo "no saved profiles"
        return 0
    end

    for f in $files
        set -l base (path basename $f)
        set -l rest (string replace -r '^credentials\.(.*)\.json$' '$1' $base)
        set -l parts (string split -m 1 '.' $rest)
        printf '%s\t%s\n' $parts[1] $parts[2]
    end
end
