function keychain-env --description 'Export a Keychain value as an env var: keychain-env NAME [ENV_NAME] [ACCOUNT]'
    if test (count $argv) -lt 1 -o (count $argv) -gt 3
        echo 'Usage: keychain-env NAME [ENV_NAME] [ACCOUNT]' >&2
        return 2
    end

    set -l name $argv[1]
    set -l env_name $name
    set -l account $USER

    if test (count $argv) -ge 2
        set env_name $argv[2]
    end
    if test (count $argv) -eq 3
        set account $argv[3]
    end

    set -l value (security find-generic-password -a "$account" -s "$name" -w)
    or return $status

    set -gx $env_name "$value"
    echo "Exported $env_name from Keychain item $name."
end
