using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private const uint FileGenericRead = 0x00120089;
    private const uint FileGenericWrite = 0x00120116;
    private const uint FileGenericExecute = 0x001200A0;
    private const uint SubContainersAndObjectsInherit = 0x00000003;
    private const uint DaclSecurityInformation = 0x00000004;
    private const uint LabelSecurityInformation = 0x00000010;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint ProcThreadAttributeHandleList = 0x00020002;
    private const uint ProcThreadAttributeSecurityCapabilities = 0x00020009;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint Infinite = 0xFFFFFFFF;
    private const int ErrorBrokenPipe = 109;

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
    private static extern int DeleteAppContainerProfile(string appContainerName);

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

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string stringSecurityDescriptor,
        uint stringSDRevision,
        out IntPtr securityDescriptor,
        out uint securityDescriptorSize);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSecurityDescriptorSacl(
        IntPtr securityDescriptor,
        [MarshalAs(UnmanagedType.Bool)] out bool saclPresent,
        out IntPtr sacl,
        [MarshalAs(UnmanagedType.Bool)] out bool saclDefaulted);

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
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ResumeThread(IntPtr thread);

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

    private sealed record AclGrant(string Path, bool IsDirectory);
    private sealed record IntegrityLabelGrant(string Path, IntPtr OriginalDescriptor, IntPtr OriginalSacl);

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || args[0] != "--request")
                throw new ArgumentException("Usage: AppContainerBroker.exe --request <request.json>");

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
        if (IsSamePath(request.Workspace, request.Scratch) || !IsSameOrAncestor(request.Scratch, request.Workspace))
            throw new InvalidDataException("The workspace copy must be a distinct directory inside the private scratch root.");
    }

    private static int RunInAppContainer(BrokerRequest request)
    {
        var executable = ResolveExecutable(request.Executable, request.Environment);
        var profileName = "BattleBuketCodes_" + Guid.NewGuid().ToString("N");
        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr processHandle = IntPtr.Zero;
        IntPtr threadHandle = IntPtr.Zero;
        IntPtr pipeRead = IntPtr.Zero;
        IntPtr pipeWrite = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr securityCapabilitiesPointer = IntPtr.Zero;
        IntPtr handleListPointer = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        var grants = new List<AclGrant>();
        var labels = new List<IntegrityLabelGrant>();

        try
        {
            var hr = CreateAppContainerProfile(
                profileName,
                "BattleBuket Codes project verification",
                "Temporary no-network AppContainer for user-approved workspace quality checks.",
                IntPtr.Zero,
                0,
                out appContainerSid);
            if (hr != 0)
                throw new SecurityException("CreateAppContainerProfile failed with HRESULT 0x" + hr.ToString("X8") + ".");

            const uint scratchRights = FileGenericRead | FileGenericWrite | FileGenericExecute | 0x00010000;
            AddGrant(request.Scratch, appContainerSid, scratchRights, SubContainersAndObjectsInherit, grants, true);
            AddLowIntegrityLabel(request.Scratch, labels);

            var pathDirectories = GetPathDirectories(request.Environment).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var directory in pathDirectories)
            {
                if (IsSameOrAncestor(directory, request.Scratch) ||
                    IsSameOrAncestor(directory, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)))
                    continue;
                AddGrant(directory, appContainerSid, FileGenericRead | FileGenericExecute, SubContainersAndObjectsInherit, grants, true);
            }
            var executableDirectory = Path.GetDirectoryName(executable);
            if (!string.IsNullOrWhiteSpace(executableDirectory) &&
                !pathDirectories.Any(path => IsSamePath(path, executableDirectory)) &&
                !IsSameOrAncestor(executableDirectory, request.Scratch))
            {
                AddGrant(executableDirectory, appContainerSid, FileGenericRead | FileGenericExecute, SubContainersAndObjectsInherit, grants, true);
            }
            AddGrant(executable, appContainerSid, FileGenericRead | FileGenericExecute, 0, grants, false);

            var securityAttributes = new SecurityAttributes
            {
                Length = Marshal.SizeOf<SecurityAttributes>(),
                InheritHandle = true
            };
            if (!CreatePipe(out pipeRead, out pipeWrite, ref securityAttributes, 0))
                ThrowLastError("CreatePipe");
            if (!SetHandleInformation(pipeRead, HandleFlagInherit, 0))
                ThrowLastError("SetHandleInformation");

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

            handleListPointer = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(handleListPointer, pipeWrite);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                new IntPtr(ProcThreadAttributeHandleList),
                handleListPointer,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
                ThrowLastError("UpdateProcThreadAttribute(HANDLE_LIST)");

            var startup = new StartupInfo
            {
                Cb = (uint)Marshal.SizeOf<StartupInfoEx>(),
                Flags = StartfUseStdHandles,
                StdInput = IntPtr.Zero,
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
                    JobObjectExtendedLimitInformation,
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
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilitiesPointer != IntPtr.Zero) Marshal.FreeHGlobal(securityCapabilitiesPointer);
            if (handleListPointer != IntPtr.Zero) Marshal.FreeHGlobal(handleListPointer);
            if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);

            for (var index = labels.Count - 1; index >= 0; index--)
            {
                try { RestoreIntegrityLabel(labels[index]); }
                catch (Exception exception) { Console.Error.WriteLine("Could not restore the temporary AppContainer integrity label: " + exception.Message); }
            }
            for (var index = grants.Count - 1; index >= 0; index--)
            {
                try { RemoveGrant(grants[index], appContainerSid); }
                catch (Exception exception) { Console.Error.WriteLine("Could not remove temporary AppContainer ACL: " + exception.Message); }
            }
            if (appContainerSid != IntPtr.Zero) FreeSid(appContainerSid);
            try { _ = DeleteAppContainerProfile(profileName); }
            catch { /* The per-run profile is unique; an inaccessible profile is not reused. */ }
        }
    }

    private static void AddLowIntegrityLabel(string path, List<IntegrityLabelGrant> labels)
    {
        var error = GetNamedSecurityInfo(
            path,
            1,
            LabelSecurityInformation,
            out _,
            out _,
            out _,
            out _,
            out var originalDescriptor);
        if (error != 0)
            throw new Win32Exception((int)error, "Could not inspect the existing integrity label for " + path + ".");

        IntPtr originalSacl = IntPtr.Zero;
        IntPtr newDescriptor = IntPtr.Zero;
        try
        {
            if (!GetSecurityDescriptorSacl(originalDescriptor, out _, out originalSacl, out _))
                ThrowLastError("GetSecurityDescriptorSacl");

            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
                "S:(ML;OICI;NW;;;LW)",
                1,
                out newDescriptor,
                out _))
                ThrowLastError("ConvertStringSecurityDescriptorToSecurityDescriptor");

            if (!GetSecurityDescriptorSacl(newDescriptor, out var newSaclPresent, out var newSacl, out _) ||
                !newSaclPresent || newSacl == IntPtr.Zero)
                throw new SecurityException("Could not create the temporary low-integrity mandatory label.");

            error = SetNamedSecurityInfo(
                path,
                1,
                LabelSecurityInformation,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                newSacl);
            if (error != 0)
                throw new Win32Exception((int)error, "Could not apply a temporary low-integrity label to " + path + ".");

            labels.Add(new IntegrityLabelGrant(path, originalDescriptor, originalSacl));
            originalDescriptor = IntPtr.Zero;
        }
        finally
        {
            if (newDescriptor != IntPtr.Zero) LocalFree(newDescriptor);
            if (originalDescriptor != IntPtr.Zero) LocalFree(originalDescriptor);
        }
    }

    private static void RestoreIntegrityLabel(IntegrityLabelGrant grant)
    {
        try
        {
            var error = SetNamedSecurityInfo(
                grant.Path,
                1,
                LabelSecurityInformation,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                grant.OriginalSacl);
            if (error != 0)
                throw new Win32Exception((int)error, "SetNamedSecurityInfo(label cleanup) failed for " + grant.Path + ".");
        }
        finally
        {
            if (grant.OriginalDescriptor != IntPtr.Zero) LocalFree(grant.OriginalDescriptor);
        }
    }

    private static void AddGrant(
        string path,
        IntPtr sid,
        uint rights,
        uint inheritance,
        List<AclGrant> grants,
        bool directory)
    {
        var fullPath = Path.GetFullPath(path);
        if (grants.Any(grant => string.Equals(grant.Path, fullPath, StringComparison.OrdinalIgnoreCase)))
            return;
        if (directory)
        {
            if (!Directory.Exists(fullPath)) return;
        }
        else if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException("The executable to run inside AppContainer was not found.", fullPath);
        }

        var error = GetNamedSecurityInfo(
            fullPath,
            1,
            DaclSecurityInformation,
            out _,
            out _,
            out var oldDacl,
            out _,
            out var securityDescriptor);
        if (error != 0) throw new Win32Exception((int)error, "GetNamedSecurityInfo failed for " + fullPath);
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
            var access = new ExplicitAccess
            {
                AccessPermissions = rights,
                AccessMode = AccessMode.GrantAccess,
                Inheritance = inheritance,
                Trustee = trustee
            };
            error = SetEntriesInAcl(1, ref access, oldDacl, out newDacl);
            if (error != 0) throw new Win32Exception((int)error, "SetEntriesInAcl failed for " + fullPath);
            error = SetNamedSecurityInfo(
                fullPath,
                1,
                DaclSecurityInformation,
                IntPtr.Zero,
                IntPtr.Zero,
                newDacl,
                IntPtr.Zero);
            if (error != 0) throw new Win32Exception((int)error, "SetNamedSecurityInfo failed for " + fullPath);
            grants.Add(new AclGrant(fullPath, directory));
        }
        finally
        {
            if (newDacl != IntPtr.Zero) LocalFree(newDacl);
            if (securityDescriptor != IntPtr.Zero) LocalFree(securityDescriptor);
        }
    }

    private static void RemoveGrant(AclGrant grant, IntPtr sid)
    {
        var error = GetNamedSecurityInfo(
            grant.Path,
            1,
            DaclSecurityInformation,
            out _,
            out _,
            out var oldDacl,
            out _,
            out var securityDescriptor);
        if (error != 0) throw new Win32Exception((int)error, "GetNamedSecurityInfo(cleanup) failed.");
        IntPtr newDacl = IntPtr.Zero;
        try
        {
            var access = new ExplicitAccess
            {
                AccessPermissions = 0,
                AccessMode = AccessMode.RevokeAccess,
                Inheritance = 0,
                Trustee = new Trustee
                {
                    MultipleTrustee = IntPtr.Zero,
                    MultipleTrusteeOperation = 0,
                    TrusteeForm = TrusteeForm.TrusteeIsSid,
                    TrusteeType = TrusteeType.TrusteeIsUser,
                    Name = sid
                }
            };
            error = SetEntriesInAcl(1, ref access, oldDacl, out newDacl);
            if (error != 0) throw new Win32Exception((int)error, "SetEntriesInAcl(cleanup) failed.");
            error = SetNamedSecurityInfo(
                grant.Path,
                1,
                DaclSecurityInformation,
                IntPtr.Zero,
                IntPtr.Zero,
                newDacl,
                IntPtr.Zero);
            if (error != 0) throw new Win32Exception((int)error, "SetNamedSecurityInfo(cleanup) failed.");
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
            if (IsSamePath(fullPath, userProfile)) continue;
            yield return fullPath;
        }
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
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed.");
    }
}
