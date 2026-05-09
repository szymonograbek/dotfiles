function killp --description 'Force kill process on a port' --argument-names port
    if not set -q port; or test -z "$port"
        echo "Usage: killp <port>"
        return 1
    end

    set -l pids (lsof -ti :$port)

    if test -z "$pids"
        echo "No process found on port $port"
        return 1
    end

    for pid in $pids
        kill -9 $pid
    end

    echo "Killed process(es) on port $port: $pids"
end
