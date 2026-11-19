<?php
// Aides pour les outils en ligne de commande (api/tools/).
declare(strict_types=1);

function cli_read_line(string $prompt): string
{
    fwrite(STDERR, $prompt);
    $l = fgets(STDIN);
    return $l === false ? '' : rtrim($l, "\r\n");
}

/**
 * Lecture d'un mot de passe : écho du terminal coupé avec stty (Unix, terminal interactif),
 * puis rétabli. Sous Windows ou sans terminal (entrée redirigée), lecture simple.
 * Le mot de passe n'est jamais écrit dans un fichier ni affiché.
 */
function cli_read_secret(string $prompt): string
{
    $hide = PHP_OS_FAMILY !== 'Windows'
        && function_exists('stream_isatty') && stream_isatty(STDIN)
        && function_exists('shell_exec');
    if ($hide) {
        $probe = @shell_exec('command -v stty 2>/dev/null');
        $hide = is_string($probe) && trim($probe) !== '';
    }
    if ($hide) {
        @shell_exec('stty -echo 2>/dev/null');
        register_shutdown_function(function (): void {
            @shell_exec('stty echo 2>/dev/null');
        });
    }
    try {
        return cli_read_line($prompt);
    } finally {
        if ($hide) {
            @shell_exec('stty echo 2>/dev/null');
            fwrite(STDERR, "\n");
        }
    }
}
