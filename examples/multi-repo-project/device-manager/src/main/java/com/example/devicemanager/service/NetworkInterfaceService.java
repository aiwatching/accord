package com.example.devicemanager.service;

import com.example.devicemanager.dto.AllInterfacesResponse;
import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;

import java.util.List;
import java.util.Optional;

public interface NetworkInterfaceService {
    List<NetworkInterface> listInterfacesByDevice(String deviceId);
    Optional<NetworkInterface> getInterface(String deviceId, String interfaceId);
    NetworkInterface createInterface(String deviceId, CreateInterfaceRequest request);
    Optional<NetworkInterface> updateInterface(String deviceId, String interfaceId, UpdateInterfaceRequest request);
    boolean deleteInterface(String deviceId, String interfaceId);

    // New method for global interface query
    AllInterfacesResponse listAllInterfaces(String deviceId, InterfaceType type,
                                           InterfaceStatus status, Boolean enabled,
                                           int page, int pageSize);
}
