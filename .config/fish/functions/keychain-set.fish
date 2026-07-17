function keychain-set --description 'Store a value in macOS Keychain: keychain-set NAME [VALUE] [ACCOUNT]'
    if test (count $argv) -lt 1 -o (count $argv) -gt 3
        echo 'Usage: keychain-set NAME [VALUE] [ACCOUNT]' >&2
        return 2
    end

    set -l name $argv[1]
    set -l account $USER

    if test (count $argv) -ge 2
        set value $argv[2]
    else
        read --silent --prompt-str "Value for $name: " value
        echo
    end

    if test (count $argv) -eq 3
        set account $argv[3]
    end

    security add-generic-password -U -a "$account" -s "$name" -w "$value"
    echo "Stored $name for $account in Keychain."
end
