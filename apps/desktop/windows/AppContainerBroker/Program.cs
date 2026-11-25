using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const uint FileGenericRead = 0x00120089;
    private const uint FileGenericExecute = 0x001200A0;
    private const uint FileTraverseAndReadAttributes = 0x000000A0;
    private const uint SubContainersAndObjectsInherit = 0x00000003;
    private const uint DaclSecurityInformation = 0x00000004;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint GenericRead = 0x80000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint ProcThreadAttributeHandleList = 0x00020002;
    private const uint ProcThreadAttributeSecurityCapabilities = 0x00020009;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint JobObjectExtendedLimitInformationClass = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint Infinite = 0xFFFFFFFF;
    private const int ErrorBrokenPipe = 109;
    private const int ErrorAlreadyExistsHResult = unchecked((int)0x800700B7);
    private const string AppContainerProfileName = "BattleBuketCodesProjectVerification";
    private const string AppContainerProfileMutexName = @"Local\BattleBuketCodes-AppContainerProfile-Lock";

    private sealed class BrokerRequest
    {
        public string Workspace { get; set; } = "";
        public string Scratch { get; set; } = "";
        public string Executable { get; set; } = "";
        public string[] Args { get; set; } = [];
        public Dictionary<string, string> Environment { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint Cb;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountChars;
        public uint YCountChars;
        public uint FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityCapabilities
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    private enum AccessMode : uint
    {
        GrantAccess = 1,
        RevokeAccess = 4
    }

    private enum TrusteeForm : uint
    {
        TrusteeIsSid = 0
    }

    private enum TrusteeType : uint
    {
        TrusteeIsUser = 1
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Trustee
    {
        public IntPtr MultipleTrustee;
        public uint MultipleTrusteeOperation;
        public TrusteeForm TrusteeForm;
        public TrusteeType TrusteeType;
        public IntPtr Name;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExplicitAccess
    {
        public uint AccessPermissions;
        public AccessMode AccessMode;
        public uint Inheritance;
        public Trustee Trustee;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(
        string appContainerName,
        string displayName,
        string description,
        IntPtr capabilities,
        uint capabilityCount,
        out IntPtr appContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeriveAppContainerSidFromAppContainerName(
        string appContainerName,
        out IntPtr appContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int GetAppContainerFolderPath(
        string appContainerSid,
        out IntPtr path);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr memory);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetNamedSecurityInfo(
        string objectName,
        uint objectType,
        uint securityInfo,
        out IntPtr owner,
        out IntPtr group,
        out IntPtr dacl,
        out IntPtr sacl,
        out IntPtr securityDescriptor);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetEffectiveRightsFromAcl(
        IntPtr acl,
        ref Trustee trustee,
        out uint accessRights);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint SetEntriesInAcl(
        uint count,
        ref ExplicitAccess explicitAccess,
        IntPtr oldAcl,
        out IntPtr newAcl);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint SetNamedSecurityInfo(
        string objectName,
        uint objectType,
        uint securityInfo,
        IntPtr owner,
        IntPtr group,
        IntPtr dacl,
        IntPtr sacl);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr FreeSid(IntPtr sid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        ref SecurityAttributes securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(
        out IntPtr readPipe,
        out IntPtr writePipe,
        ref SecurityAttributes pipeAttributes,
        uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        uint flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        uint informationClass,
        IntPtr jobObjectInformation,
        uint jobObjectInformationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(
        IntPtr file,
        byte[] buffer,
        uint bytesToRead,
        out uint bytesRead,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint SearchPath(
        string? path,
        string fileName,
        string? extension,
        uint bufferLength,
        StringBuilder buffer,
        out IntPtr filePart);

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--prepare")
                return PrepareSandboxRoot();
            if (args.Length != 2 || args[0] != "--request")
                throw new ArgumentException("Usage: AppContainerBroker.exe --prepare | --request <request.json>");

            var requestPath = Path.GetFullPath(args[1]);
            var requestJson = File.ReadAllText(requestPath, Encoding.UTF8);
            var request = JsonSerializer.Deserialize<BrokerRequest>(
                requestJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("The sandbox request file is empty.");

            ValidateRequest(request);
            return RunInAppContainer(request);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("Windows AppContainer broker refused execution: " + exception.Message);
            return 125;
        }
    }

    private static void ValidateRequest(BrokerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Workspace) || !Directory.Exists(request.Workspace))
            throw new InvalidDataException("The requested workspace does not exist.");
        if (string.IsNullOrWhiteSpace(request.Scratch) || !Directory.Exists(request.Scratch))
            throw new InvalidDataException("The temporary sandbox directory does not exist.");
        if (string.IsNullOrWhiteSpace(request.Executable) || request.Executable.Length > 4096)
            throw new InvalidDataException("The requested executable is invalid.");
        if (request.Args.Length > 256 || request.Args.Any(value => value is null || value.Length > 16_384))
            throw new InvalidDataException("The command argument list exceeds its safety limits.");
        if (request.Environment.Count > 128 ||
            request.Environment.Any(pair => pair.Key.Length > 256 || pair.Value.Length > 32_768 ||
                pair.Key.Contains('=') || pair.Key.Contains('\0') || pair.Value.Contains('\0')))
            throw new InvalidDataException("The command environment exceeds its safety limits.");

        request.Workspace = Path.GetFullPath(request.Workspace);
        request.Scratch = Path.GetFullPath(request.Scratch);
        var profileFolder = GetAppContainerDataRoot();
        var profileTempRoot = Path.Combine(profileFolder, "Temp");
        if (!IsSameOrAncestor(profileTempRoot, request.Scratch) || IsSamePath(profileTempRoot, request.Scratch))
            throw new InvalidDataException("The scratch directory must be a child of this AppContainer profile's private Temp directory.");
        if (!string.Equals(request.Workspace, Path.Combine(request.Scratch, "workspace"), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The requested workspace must be the designated workspace folder inside the private AppContainer Temp directory.");
    }

    private static int RunInAppContainer(BrokerRequest request)
    {
        var executable = ResolveExecutable(request.Executable, request.Environment);
        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr processHandle = IntPtr.Zero;
        IntPtr threadHandle = IntPtr.Zero;
        IntPtr pipeRead = IntPtr.Zero;
        IntPtr pipeWrite = IntPtr.Zero;
        IntPtr standardInput = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr securityCapabilitiesPointer = IntPtr.Zero;
        IntPtr handleListPointer = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        try
        {
            appContainerSid = EnsureAppContainerProfile();
            var profileFolder = GetProfileFolderPath(appContainerSid);
            var profileTempRoot = Path.Combine(profileFolder, "Temp");
            if (!IsSameOrAncestor(profileTempRoot, request.Scratch) || IsSamePath(profileTempRoot, request.Scratch))
                throw new SecurityException("The sandbox scratch directory is outside the AppContainer-managed profile Temp location.");

            var pathDirectories = GetPathDirectories(request.Environment).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var directory in pathDirectories)
            {
                if (IsSameOrAncestor(request.Scratch, directory) || IsReadOnlySystemPath(directory))
                    continue;
                EnsureToolchainTraversal(directory, appContainerSid);
                EnsureReadExecuteGrant(directory, appContainerSid);
            }
            var executableDirectory = Path.GetDirectoryName(executable);
            if (!string.IsNullOrWhiteSpace(executableDirectory) &&
                !pathDirectories.Any(path => IsSamePath(path, executableDirectory)) &&
                !IsSameOrAncestor(request.Scratch, executableDirectory) &&
                !IsReadOnlySystemPath(executableDirectory))
            {
                EnsureToolchainTraversal(executableDirectory, appContainerSid);
                EnsureReadExecuteGrant(executableDirectory, appContainerSid);
            }
            if (!IsReadOnlySystemPath(executable) &&
                !IsSameOrAncestor(request.Scratch, executable))
            {
                EnsureToolchainTraversal(executable, appContainerSid);
                EnsureReadExecuteGrant(executable, appContainerSid);
            }

            var securityAttributes = new SecurityAttributes
            {
                Length = Marshal.SizeOf<SecurityAttributes>(),
                InheritHandle = true
            };
            if (!CreatePipe(out pipeRead, out pipeWrite, ref securityAttributes, 0))
                ThrowLastError("CreatePipe");
            if (!SetHandleInformation(pipeRead, HandleFlagInherit, 0))
                ThrowLastError("SetHandleInformation");
            standardInput = CreateFile(
                "NUL",
                GenericRead,
                FileShareRead | FileShareWrite,
                ref securityAttributes,
                OpenExisting,
                FileAttributeNormal,
                IntPtr.Zero);
            if (standardInput == new IntPtr(-1))
                ThrowLastError("CreateFile(NUL)");

            IntPtr attributeListSize = IntPtr.Zero;
            _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListSize);
            if (attributeListSize == IntPtr.Zero)
                ThrowLastError("InitializeProcThreadAttributeList(size)");
            attributeList = Marshal.AllocHGlobal(attributeListSize);
            if (!InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeListSize))
                ThrowLastError("InitializeProcThreadAttributeList");

            var securityCapabilities = new SecurityCapabilities
            {
                AppContainerSid = appContainerSid,
                Capabilities = IntPtr.Zero,
                CapabilityCount = 0,
                Reserved = 0
            };
            securityCapabilitiesPointer = Marshal.AllocHGlobal(Marshal.SizeOf<SecurityCapabilities>());
            Marshal.StructureToPtr(securityCapabilities, securityCapabilitiesPointer, false);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                new IntPtr(ProcThreadAttributeSecurityCapabilities),
                securityCapabilitiesPointer,
                new IntPtr(Marshal.SizeOf<SecurityCapabilities>()),
                IntPtr.Zero,
                IntPtr.Zero))
                ThrowLastError("UpdateProcThreadAttribute(SECURITY_CAPABILITIES)");

            handleListPointer = Marshal.AllocHGlobal(IntPtr.Size * 2);
            Marshal.WriteIntPtr(handleListPointer, 0, standardInput);
            Marshal.WriteIntPtr(handleListPointer, IntPtr.Size, pipeWrite);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                new IntPtr(ProcThreadAttributeHandleList),
                handleListPointer,
                new IntPtr(IntPtr.Size * 2),
                IntPtr.Zero,
                IntPtr.Zero))
                ThrowLastError("UpdateProcThreadAttribute(HANDLE_LIST)");

            var startup = new StartupInfo
            {
                Cb = (uint)Marshal.SizeOf<StartupInfoEx>(),
                Flags = StartfUseStdHandles,
                StdInput = standardInput,
                StdOutput = pipeWrite,
                StdError = pipeWrite
            };
            var startupEx = new StartupInfoEx { StartupInfo = startup, AttributeList = attributeList };
            var commandLine = new StringBuilder(BuildCommandLine(executable, request.Args));
            environmentPointer = BuildEnvironmentBlock(request.Environment);

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) ThrowLastError("CreateJobObject");
            var jobLimits = new JobObjectExtendedLimitInformation();
            jobLimits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            var jobLimitsPointer = Marshal.AllocHGlobal(Marshal.SizeOf<JobObjectExtendedLimitInformation>());
            try
            {
                Marshal.StructureToPtr(jobLimits, jobLimitsPointer, false);
                if (!SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformationClass,
                    jobLimitsPointer,
                    (uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>()))
                    ThrowLastError("SetInformationJobObject");
            }
            finally
            {
                Marshal.FreeHGlobal(jobLimitsPointer);
            }

            if (!CreateProcess(
                executable,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                ExtendedStartupInfoPresent | CreateUnicodeEnvironment | CreateSuspended | CreateNoWindow,
                environmentPointer,
                request.Workspace,
                ref startupEx,
                out var processInformation))
                ThrowLastError("CreateProcess(AppContainer)");

            processHandle = processInformation.Process;
            threadHandle = processInformation.Thread;

            if (!AssignProcessToJobObject(job, processHandle))
            {
                TerminateProcess(processHandle, 125);
                ThrowLastError("AssignProcessToJobObject");
            }
            if (ResumeThread(threadHandle) == uint.MaxValue)
            {
                TerminateJobObject(job, 125);
                ThrowLastError("ResumeThread");
            }

            CloseHandle(pipeWrite);
            pipeWrite = IntPtr.Zero;

            var output = Console.OpenStandardOutput();
            var buffer = new byte[32 * 1024];
            while (true)
            {
                if (!ReadFile(pipeRead, buffer, (uint)buffer.Length, out var bytesRead, IntPtr.Zero))
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error == ErrorBrokenPipe) break;
                    throw new Win32Exception(error, "ReadFile(child output) failed.");
                }
                if (bytesRead == 0) break;
                output.Write(buffer, 0, (int)bytesRead);
                output.Flush();
            }

            var wait = WaitForSingleObject(processHandle, Infinite);
            if (wait != 0)
                ThrowLastError("WaitForSingleObject");
            if (!GetExitCodeProcess(processHandle, out var exitCode))
                ThrowLastError("GetExitCodeProcess");
            return unchecked((int)exitCode);
        }
        finally
        {
            if (job != IntPtr.Zero)
            {
                _ = TerminateJobObject(job, 125);
                CloseHandle(job);
            }
            if (processHandle != IntPtr.Zero) CloseHandle(processHandle);
            if (threadHandle != IntPtr.Zero) CloseHandle(threadHandle);
            if (pipeRead != IntPtr.Zero) CloseHandle(pipeRead);
            if (pipeWrite != IntPtr.Zero) CloseHandle(pipeWrite);
            if (standardInput != IntPtr.Zero && standardInput != new IntPtr(-1)) CloseHandle(standardInput);
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilitiesPointer != IntPtr.Zero) Marshal.FreeHGlobal(securityCapabilitiesPointer);
            if (handleListPointer != IntPtr.Zero) Marshal.FreeHGlobal(handleListPointer);
            if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);

            if (appContainerSid != IntPtr.Zero) FreeSid(appContainerSid);
        }
    }

    private static int PrepareSandboxRoot()
    {
        var profileFolder = GetProfileFolderPath();
        var tempRoot = Path.Combine(profileFolder, "Temp");
        Directory.CreateDirectory(tempRoot);
        var sandboxRoot = Path.Combine(tempRoot, "BattleBuketCodes_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(sandboxRoot);
        Console.Out.WriteLine(sandboxRoot);
        return 0;
    }

    private static string GetAppContainerDataRoot()
    {
        var sid = EnsureAppContainerProfile();
        try { return GetAppContainerDataRoot(sid); }
        finally { FreeSid(sid); }
    }

    private static string GetAppContainerDataRoot(IntPtr sid)
    {
        var profileFolder = GetProfileFolderPath(sid);
        return string.Equals(Path.GetFileName(profileFolder), "AC", StringComparison.OrdinalIgnoreCase)
            ? profileFolder
            : Path.Combine(profileFolder, "AC");
    }

    private static IntPtr EnsureAppContainerProfile()
    {
        using var mutex = new Mutex(false, AppContainerProfileMutexName);
        var acquired = false;
        try
        {
            try
            {
                acquired = mutex.WaitOne(TimeSpan.FromSeconds(120));
            }
            catch (AbandonedMutexException)
            {
                acquired = true;
            }

            if (!acquired)
                throw new TimeoutException("Timed out waiting for the AppContainer profile initialization lock.");

            var result = CreateAppContainerProfile(
                AppContainerProfileName,
                "BattleBuket Codes project verification",
                "Persistent no-network AppContainer for isolated project quality checks.",
                IntPtr.Zero,
                0,
                out var sid);
            if (result == 0)
                return sid;
            if (result == ErrorAlreadyExistsHResult)
            {
                if (DeriveAppContainerSidFromAppContainerName(AppContainerProfileName, out sid) != 0)
                    throw new SecurityException("Could not derive the existing BattleBuket Codes AppContainer SID.");
                return sid;
            }
            throw new SecurityException("CreateAppContainerProfile failed with HRESULT 0x" + result.ToString("X8") + ".");
        }
        finally
        {
            if (acquired) mutex.ReleaseMutex();
        }
    }

    private static string GetProfileFolderPath()
    {
        var sid = EnsureAppContainerProfile();
        try { return GetProfileFolderPath(sid); }
        finally { FreeSid(sid); }
    }

    private static string GetProfileFolderPath(IntPtr sid)
    {
        if (!ConvertSidToStringSid(sid, out var sidString))
            ThrowLastError("ConvertSidToStringSid");
        string sidText;
        try
        {
            sidText = Marshal.PtrToStringUni(sidString)
                ?? throw new SecurityException("Could not convert the AppContainer SID to text.");
        }
        finally
        {
            LocalFree(sidString);
        }

        var result = GetAppContainerFolderPath(sidText, out var folderPointer);
        if (result != 0)
            throw new SecurityException("GetAppContainerFolderPath failed with HRESULT 0x" + result.ToString("X8") + ".");
        try
        {
            var folder = Marshal.PtrToStringUni(folderPointer)
                ?? throw new SecurityException("Windows returned an empty AppContainer profile folder.");
            return Path.GetFullPath(folder);
        }
        finally
        {
            CoTaskMemFree(folderPointer);
        }
    }

    private static void EnsureToolchainTraversal(string path, IntPtr sid)
    {
        var fullPath = Path.GetFullPath(path);
        var current = Directory.Exists(fullPath) ? fullPath : Path.GetDirectoryName(fullPath);
        while (!string.IsNullOrWhiteSpace(current))
        {
            if (!IsReadOnlySystemPath(current))
                EnsureSpecificRights(current, sid, FileTraverseAndReadAttributes, false);
            var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(current));
            if (string.IsNullOrWhiteSpace(parent) || string.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                break;
            current = parent;
        }
    }

    private static void EnsureReadExecuteGrant(string path, IntPtr sid)
    {
        EnsureSpecificRights(path, sid, FileGenericRead | FileGenericExecute, true);
    }

    private static void EnsureSpecificRights(string path, IntPtr sid, uint requiredRights, bool allowInheritance)
    {
        var fullPath = Path.GetFullPath(path);
        var isDirectory = Directory.Exists(fullPath);
        if (!isDirectory && !File.Exists(fullPath))
            throw new FileNotFoundException("A required toolchain path does not exist.", fullPath);
        if (IsReadOnlySystemPath(fullPath))
            return;

        const uint objectType = 1;
        var error = GetNamedSecurityInfo(
            fullPath,
            objectType,
            DaclSecurityInformation,
            out _,
            out _,
            out var oldDacl,
            out _,
            out var securityDescriptor);
        if (error != 0)
            throw new Win32Exception((int)error, "GetNamedSecurityInfo failed for " + fullPath);

        IntPtr newDacl = IntPtr.Zero;
        try
        {
            var trustee = new Trustee
            {
                MultipleTrustee = IntPtr.Zero,
                MultipleTrusteeOperation = 0,
                TrusteeForm = TrusteeForm.TrusteeIsSid,
                TrusteeType = TrusteeType.TrusteeIsUser,
                Name = sid
            };
            if (oldDacl != IntPtr.Zero)
            {
                error = GetEffectiveRightsFromAcl(oldDacl, ref trustee, out var currentRights);
                if (error != 0)
                    throw new Win32Exception((int)error, "GetEffectiveRightsFromAcl failed for " + fullPath);
                if ((currentRights & requiredRights) == requiredRights)
                    return;
            }

            var access = new ExplicitAccess
            {
                AccessPermissions = requiredRights,
                AccessMode = AccessMode.GrantAccess,
                Inheritance = allowInheritance && isDirectory ? SubContainersAndObjectsInherit : 0,
                Trustee = trustee
            };
            error = SetEntriesInAcl(1, ref access, oldDacl, out newDacl);
            if (error != 0)
                throw new Win32Exception((int)error, "SetEntriesInAcl failed for " + fullPath);
            error = SetNamedSecurityInfo(
                fullPath,
                objectType,
                DaclSecurityInformation,
                IntPtr.Zero,
                IntPtr.Zero,
                newDacl,
                IntPtr.Zero);
            if (error != 0)
                throw new Win32Exception((int)error, "SetNamedSecurityInfo failed for " + fullPath);
        }
        finally
        {
            if (newDacl != IntPtr.Zero) LocalFree(newDacl);
            if (securityDescriptor != IntPtr.Zero) LocalFree(securityDescriptor);
        }
    }

    private static IEnumerable<string> GetPathDirectories(Dictionary<string, string> environment)
    {
        var path = environment.TryGetValue("PATH", out var value) ? value : "";
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var segment in path.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(segment.Trim('"')));
            }
            catch { continue; }
            if (!Directory.Exists(fullPath)) continue;
            if (IsReadOnlySystemPath(fullPath) || IsSameOrAncestor(fullPath, userProfile)) continue;
            yield return fullPath;
        }
    }

    private static bool IsReadOnlySystemPath(string path)
    {
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        return IsSameOrAncestor(windows, path) ||
            IsSameOrAncestor(programFiles, path) ||
            IsSameOrAncestor(programFilesX86, path);
    }

    private static bool IsSamePath(string left, string right)
    {
        if (string.IsNullOrWhiteSpace(right)) return false;
        return string.Equals(
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)),
            StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSameOrAncestor(string parent, string candidate)
    {
        var left = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent));
        var right = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
        if (string.Equals(left, right, StringComparison.OrdinalIgnoreCase)) return true;
        return right.StartsWith(left + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveExecutable(string executable, Dictionary<string, string> environment)
    {
        if (Path.IsPathRooted(executable)) return Path.GetFullPath(executable);
        var path = environment.TryGetValue("PATH", out var value) ? value : "";
        var buffer = new StringBuilder(32_768);
        var length = SearchPath(path, executable, null, (uint)buffer.Capacity, buffer, out _);
        if (length == 0 || length >= (uint)buffer.Capacity)
            throw new FileNotFoundException("Could not resolve executable from the approved PATH.", executable);
        var resolved = Path.GetFullPath(buffer.ToString());
        if (!File.Exists(resolved))
            throw new FileNotFoundException("Resolved executable does not exist.", resolved);
        return resolved;
    }

    private static IntPtr BuildEnvironmentBlock(Dictionary<string, string> environment)
    {
        var normalized = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in environment)
        {
            if (!string.IsNullOrWhiteSpace(pair.Key)) normalized[pair.Key] = pair.Value;
        }
        var lines = normalized
            .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .Select(pair => pair.Key + "=" + pair.Value);
        var block = string.Join("\0", lines) + "\0\0";
        return Marshal.StringToHGlobalUni(block);
    }

    private static string BuildCommandLine(string executable, IEnumerable<string> args)
    {
        return string.Join(" ", new[] { executable }.Concat(args).Select(QuoteArgument));
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && !value.Any(character => char.IsWhiteSpace(character) || character == '"'))
            return value;

        var result = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }

            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }

        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static void ThrowLastError(string operation)
    {
        var error = Marshal.GetLastWin32Error();
        var detail = new Win32Exception(error).Message;
        throw new Win32Exception(error, operation + " failed with Win32 error " + error + " (0x" + error.ToString("X8") + "): " + detail);
    }
}
