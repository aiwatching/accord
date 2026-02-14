package com.example.devicemanager.model;

import java.time.Instant;

public class Device {

    private String id;
    private String name;
    private String ipAddress;
    private String macAddress;
    private DeviceStatus status;
    private Instant lastSeen;

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
}
