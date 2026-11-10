!macro customInstall
  ExecShell "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall add rule name="Mihrab Installed Local Sync" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP localport=17777 remoteip=LocalSubnet profile=private enable=yes'
!macroend

!macro customUnInstall
  ExecShell "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="Mihrab Installed Local Sync" dir=in program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP localport=17777'
!macroend
