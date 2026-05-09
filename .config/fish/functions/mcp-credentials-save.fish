function mcp-credentials-save --description 'Save current mcporter credentials for a server under a profile name'
    if test (count $argv) -ne 2
        echo "usage: mcp-credentials-save <mcp-name> <credentials-name>" >&2
        return 2
    end

    set -l mcp $argv[1]
    set -l name $argv[2]
    set -l creds_file ~/.mcporter/credentials.json
    set -l out_file ~/.mcporter/credentials.$mcp.$name.json

    if not test -f $creds_file
        echo "credentials file not found: $creds_file" >&2
        return 1
    end

    set -l keys (jq -r --arg m "$mcp" '.entries | keys[] | select(startswith($m + "|"))' $creds_file)
    set -l n (count $keys)
    if test $n -eq 0
        echo "no entry for '$mcp' in $creds_file — run 'mcporter auth $mcp' first" >&2
        return 1
    end
    if test $n -gt 1
        echo "multiple entries for '$mcp': $keys" >&2
        return 1
    end

    jq --arg k $keys[1] '.entries[$k]' $creds_file >$out_file
    echo "saved $keys[1] → $out_file"
end
