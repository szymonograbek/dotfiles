function keychain-get --description 'Read a value from macOS Keychain: keychain-get NAME [ACCOUNT]'
    if test (count $argv) -lt 1 -o (count $argv) -gt 2
        echo 'Usage: keychain-get NAME [ACCOUNT]' >&2
        return 2
    end

    set -l name $argv[1]
    set -l account $USER
    if test (count $argv) -eq 2
        set account $argv[2]
    end

    security find-generic-password -a "$account" -s "$name" -w
end
