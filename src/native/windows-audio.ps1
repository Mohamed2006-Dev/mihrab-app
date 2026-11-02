param(
  [ValidateSet('read', 'mute', 'restore')][string]$Action = 'read',
  [string]$State = 'e30='
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Core Audio controls the selected endpoint directly; never toggle the mute key.
# https://learn.microsoft.com/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace MihrabAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  internal class DeviceEnumerator {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IDeviceEnumerator {
    int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
    int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out uint state);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint channels);
    int SetMasterVolumeLevel(float level, ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
  }

  public class AudioState {
    public string deviceId;
    public float volume;
    public bool muted;
  }

  public static class Endpoint {
    private static void Check(int result) { Marshal.ThrowExceptionForHR(result); }

    public static AudioState Execute(string action, string deviceId, float volume, bool muted) {
      IDeviceEnumerator enumerator = null;
      IDevice device = null;
      IEndpointVolume endpoint = null;
      try {
        enumerator = (IDeviceEnumerator)new DeviceEnumerator();
        if (action == "read") Check(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
        else {
          if (String.IsNullOrEmpty(deviceId)) throw new ArgumentException("Missing original audio device.");
          Check(enumerator.GetDevice(deviceId, out device));
        }
        Guid iid = typeof(IEndpointVolume).GUID;
        object instance;
        Check(device.Activate(ref iid, 23, IntPtr.Zero, out instance));
        endpoint = (IEndpointVolume)instance;
        Guid context = Guid.Empty;
        if (action == "mute") Check(endpoint.SetMute(true, ref context));
        else if (action == "restore") {
          if (Single.IsNaN(volume) || Single.IsInfinity(volume) || volume < 0 || volume > 1) throw new ArgumentOutOfRangeException("volume");
          // Restore level before unmuting to avoid a momentary jump in loudness.
          Check(endpoint.SetMasterVolumeLevelScalar(volume, ref context));
          Check(endpoint.SetMute(muted, ref context));
        }
        string id; float currentVolume; bool currentMute;
        Check(device.GetId(out id));
        Check(endpoint.GetMasterVolumeLevelScalar(out currentVolume));
        Check(endpoint.GetMute(out currentMute));
        return new AudioState { deviceId = id, volume = currentVolume, muted = currentMute };
      } finally {
        if (endpoint != null) Marshal.ReleaseComObject(endpoint);
        if (device != null) Marshal.ReleaseComObject(device);
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
      }
    }
  }
}
'@

$saved = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($State)) | ConvertFrom-Json
$result = [MihrabAudio.Endpoint]::Execute($Action, [string]$saved.deviceId, [float]$saved.volume, [bool]$saved.muted)
$result | ConvertTo-Json -Compress
