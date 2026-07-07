function pi-loop --description 'Run pi headlessly over tickets/<n>.md in order'
    if test (count $argv) -gt 2
        echo "Usage: pi-loop [START [END]]" >&2
        echo "Examples:" >&2
        echo "  pi-loop      # runs tickets/1.md through the highest numbered ticket" >&2
        echo "  pi-loop 4    # runs tickets/4.md through the highest numbered ticket" >&2
        echo "  pi-loop 1 4  # runs tickets/1.md through tickets/4.md" >&2
        return 2
    end

    set -l ticket_numbers
    for ticket_file in tickets/*.md
        set -l ticket_number (basename $ticket_file .md)
        if string match -qr '^[0-9]+$' -- $ticket_number
            set -a ticket_numbers $ticket_number
        end
    end

    if test (count $ticket_numbers) -eq 0
        echo "pi-loop: no numbered ticket files found in tickets/" >&2
        return 1
    end

    set ticket_numbers (printf '%s\n' $ticket_numbers | sort -n)

    set -l start 1
    set -l end $ticket_numbers[-1]

    if test (count $argv) -ge 1
        set start $argv[1]
    end

    if test (count $argv) -eq 2
        set end $argv[2]
    end

    if not string match -qr '^[0-9]+$' -- $start; or not string match -qr '^[0-9]+$' -- $end
        echo "pi-loop: START and END must be positive ticket numbers" >&2
        return 2
    end

    if test $start -gt $end
        echo "pi-loop: START must be less than or equal to END" >&2
        return 2
    end

    for ticket_number in (seq $start $end)
        set -l ticket_file "tickets/$ticket_number.md"

        if not test -f $ticket_file
            echo "pi-loop: missing $ticket_file" >&2
            return 1
        end

        echo "==> pi-loop: implementing $ticket_file"

        set -l output_file (mktemp)

        pi --print --approve --name "ticket $ticket_number" @$ticket_file \
            "Read and implement $ticket_file. Work only on this ticket; do not implement later tickets. Run relevant verification. Use your best judgement for minor ambiguities. Only if hard-blocked, end your response with a line starting exactly with BLOCKED:." \
            | tee $output_file

        set -l status_code $pipestatus[1]

        if tail -n 20 $output_file | string match -qr '^BLOCKED:'
            rm $output_file
            echo "pi-loop: blocked on $ticket_file" >&2
            return 1
        end

        rm $output_file
        if test $status_code -ne 0
            echo "pi-loop: pi failed on $ticket_file with status $status_code" >&2
            return $status_code
        end
    end
end
