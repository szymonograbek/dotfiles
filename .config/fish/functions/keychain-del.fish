function keychain-del --description 'Delete a value from macOS Keychain: keychain-del NAME [ACCOUNT]'
    if test (count $argv) -lt 1 -o (count $argv) -gt 2
        echo 'Usage: keychain-del NAME [ACCOUNT]' >&2
        return 2
    end

    set -l name $argv[1]
    set -l account $USER
    if test (count $argv) -eq 2
        set account $argv[2]
    end

    security delete-generic-password -a "$account" -s "$name"
end
