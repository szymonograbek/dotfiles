function mcpc-use --description 'Load saved mcporter credentials for a server profile into credentials.json'
    if test (count $argv) -ne 2
        echo "usage: mcpc-use <mcp-name> <credentials-name>" >&2
        return 2
    end

    set -l mcp $argv[1]
    set -l name $argv[2]
    set -l creds_file ~/.mcporter/credentials.json
    set -l in_file ~/.mcporter/credentials.$mcp.$name.json

    if not test -f $in_file
        echo "saved profile not found: $in_file" >&2
        return 1
    end
    if not test -f $creds_file
        echo "credentials file not found: $creds_file — run 'mcporter auth $mcp' once first" >&2
        return 1
    end

    set -l keys (jq -r --arg m "$mcp" '.entries | keys[] | select(startswith($m + "|"))' $creds_file)
    set -l n (count $keys)
    if test $n -eq 0
        echo "no entry for '$mcp' in $creds_file — run 'mcporter auth $mcp' once to establish the key" >&2
        return 1
    end
    if test $n -gt 1
        echo "multiple entries for '$mcp': $keys" >&2
        return 1
    end

    set -l tmp (mktemp)
    jq --arg k $keys[1] --slurpfile v $in_file '.entries[$k] = $v[0]' $creds_file >$tmp
    and mv $tmp $creds_file
    or begin
        rm -f $tmp
        echo "failed to update $creds_file" >&2
        return 1
    end
    echo "loaded $in_file → $keys[1]"
end
