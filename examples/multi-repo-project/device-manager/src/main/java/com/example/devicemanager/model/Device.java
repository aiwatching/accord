package com.example.devicemanager.model;

import java.time.Instant;

public class Device {

    private String id;
    private String name;
    private String ipAddress;
    private String macAddress;
    private DeviceStatus status;
    private Instant lastSeen;

    // Authentication fields
    private String authUsername;
    private String authPassword;  // Encrypted
    private String authToken;
    private AuthType authType;
    private String sshPublicKey;
    private String certificate;
    private Boolean authEnabled;
    private Instant lastAuthUpdate;

    public Device() {}

    public Device(String id, String name, String ipAddress, String macAddress, DeviceStatus status) {
        this.id = id;
        this.name = name;
        this.ipAddress = ipAddress;
        this.macAddress = macAddress;
        this.status = status;
        this.lastSeen = Instant.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getIpAddress() { return ipAddress; }
    public void setIpAddress(String ipAddress) { this.ipAddress = ipAddress; }

    public String getMacAddress() { return macAddress; }
    public void setMacAddress(String macAddress) { this.macAddress = macAddress; }

    public DeviceStatus getStatus() { return status; }
    public void setStatus(DeviceStatus status) { this.status = status; }

    public Instant getLastSeen() { return lastSeen; }
    public void setLastSeen(Instant lastSeen) { this.lastSeen = lastSeen; }

    public String getAuthUsername() { return authUsername; }
    public void setAuthUsername(String authUsername) { this.authUsername = authUsername; }

    public String getAuthPassword() { return authPassword; }
    public void setAuthPassword(String authPassword) { this.authPassword = authPassword; }

    public String getAuthToken() { return authToken; }
    public void setAuthToken(String authToken) { this.authToken = authToken; }

    public AuthType getAuthType() { return authType; }
    public void setAuthType(AuthType authType) { this.authType = authType; }

    public String getSshPublicKey() { return sshPublicKey; }
    public void setSshPublicKey(String sshPublicKey) { this.sshPublicKey = sshPublicKey; }

    public String getCertificate() { return certificate; }
    public void setCertificate(String certificate) { this.certificate = certificate; }

    public Boolean getAuthEnabled() { return authEnabled; }
    public void setAuthEnabled(Boolean authEnabled) { this.authEnabled = authEnabled; }

    public Instant getLastAuthUpdate() { return lastAuthUpdate; }
    public void setLastAuthUpdate(Instant lastAuthUpdate) { this.lastAuthUpdate = lastAuthUpdate; }
}
