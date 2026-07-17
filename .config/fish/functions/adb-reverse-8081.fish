function adb-reverse-8081 --description 'Reverse tcp:8081 on every connected adb device'
    if not command -q adb
        echo 'adb not found' >&2
        return 127
    end

    set -l devices (adb devices | awk '$2 == "device" { print $1 }')

    if test (count $devices) -eq 0
        echo 'No connected adb devices found.' >&2
        return 1
    end

    for device in $devices
        echo "adb -s $device reverse tcp:8081 tcp:8081"
        adb -s $device reverse tcp:8081 tcp:8081
    end
end
