using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

// A GUI executable lets Explorer resolve "pai" without a console or script host.
internal static class PaiLauncher
{
    private const string ApplicationName = "Pi Desktop.exe";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string directory = ParseDirectory(args);
            string binDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string application = Path.GetFullPath(Path.Combine(binDirectory, "..", ApplicationName));
            if (!File.Exists(application))
                throw new FileNotFoundException("Pi Desktop executable was not found. Reinstall Pi Desktop to repair the pai command.", application);

            ProcessStartInfo start = new ProcessStartInfo(application);
            start.Arguments = "--pai --cwd " + QuoteArgument(directory);
            start.WorkingDirectory = directory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            using (Process process = Process.Start(start)) { }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "pai - Pi Desktop", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    internal static string ParseDirectory(string[] args)
    {
        string directory;
        if (args.Length == 0) directory = Directory.GetCurrentDirectory();
        else if (args.Length == 1 && args[0].StartsWith("--cwd=", StringComparison.Ordinal))
            directory = args[0].Substring("--cwd=".Length);
        else if (args.Length == 1 && !IsDirectoryOption(args[0])) directory = args[0];
        else if (args.Length == 2 && IsDirectoryOption(args[0])) directory = args[1];
        else throw new ArgumentException("Usage: pai [folder] or pai --cwd <folder>");

        if (String.IsNullOrWhiteSpace(directory)) throw new ArgumentException("pai requires a filesystem directory.");
        directory = Path.GetFullPath(directory);
        if (!Directory.Exists(directory)) throw new DirectoryNotFoundException("The folder does not exist: " + directory);
        return directory;
    }

    private static bool IsDirectoryOption(string argument)
    {
        return String.Equals(argument, "-Cwd", StringComparison.OrdinalIgnoreCase)
            || String.Equals(argument, "--cwd", StringComparison.Ordinal);
    }

    // Follow the Windows CRT argv rules, including a quoted drive root's final \.
    internal static string QuoteArgument(string value)
    {
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') quoted.Append('\\', slashes * 2 + 1);
            else quoted.Append('\\', slashes);
            quoted.Append(character);
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }
}
