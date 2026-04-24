' launch-silent.vbs — invisible launcher. Runs launch.bat without any console flicker.
' Double-click this instead of launch.bat if you want zero visible windows.

Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
WshShell.Run """" & scriptDir & "\launch.bat""", 0, False
