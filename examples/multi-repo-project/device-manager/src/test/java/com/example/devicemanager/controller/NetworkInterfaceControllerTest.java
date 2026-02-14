package com.example.devicemanager.controller;

import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.service.NetworkInterfaceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Arrays;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(NetworkInterfaceController.class)
class NetworkInterfaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private NetworkInterfaceService interfaceService;

    @Test
    void listInterfaces_returnsListOfInterfaces() throws Exception {
        // Arrange
        String deviceId = "device1";
        NetworkInterface iface1 = createTestInterface("iface1", deviceId, "eth0");
        NetworkInterface iface2 = createTestInterface("iface2", deviceId, "wlan0");

        when(interfaceService.listInterfacesByDevice(deviceId)).thenReturn(Arrays.asList(iface1, iface2));

        // Act & Assert
        mockMvc.perform(get("/api/devices/{deviceId}/interfaces", deviceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].id").value("iface1"))
                .andExpect(jsonPath("$[0].name").value("eth0"))
                .andExpect(jsonPath("$[1].id").value("iface2"))
                .andExpect(jsonPath("$[1].name").value("wlan0"));
    }

    @Test
    void getInterface_interfaceExists_returnsInterface() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface iface = createTestInterface(interfaceId, deviceId, "eth0");

        when(interfaceService.getInterface(deviceId, interfaceId)).thenReturn(Optional.of(iface));

        // Act & Assert
        mockMvc.perform(get("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(interfaceId))
                .andExpect(jsonPath("$.name").value("eth0"))
                .andExpect(jsonPath("$.deviceId").value(deviceId));
    }

    @Test
    void getInterface_interfaceDoesNotExist_returns404() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";

        when(interfaceService.getInterface(deviceId, interfaceId)).thenReturn(Optional.empty());

        // Act & Assert
        mockMvc.perform(get("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId))
                .andExpect(status().isNotFound());
    }

    @Test
    void createInterface_validRequest_returnsCreatedInterface() throws Exception {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        request.setIpAddress("192.168.1.100");
        request.setEnabled(true);

        NetworkInterface created = createTestInterface("iface1", deviceId, "eth0");
        created.setIpAddress("192.168.1.100");

        when(interfaceService.createInterface(eq(deviceId), any(CreateInterfaceRequest.class))).thenReturn(created);

        // Act & Assert
        mockMvc.perform(post("/api/devices/{deviceId}/interfaces", deviceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("iface1"))
                .andExpect(jsonPath("$.deviceId").value(deviceId))
                .andExpect(jsonPath("$.name").value("eth0"))
                .andExpect(jsonPath("$.ipAddress").value("192.168.1.100"));
    }

    @Test
    void createInterface_invalidRequest_returns400() throws Exception {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("invalid-mac");

        when(interfaceService.createInterface(eq(deviceId), any(CreateInterfaceRequest.class)))
                .thenThrow(new IllegalArgumentException("Invalid MAC address"));

        // Act & Assert
        mockMvc.perform(post("/api/devices/{deviceId}/interfaces", deviceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateInterface_validRequest_returnsUpdatedInterface() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");
        request.setIpAddress("192.168.1.101");
        request.setEnabled(false);

        NetworkInterface updated = createTestInterface(interfaceId, deviceId, "eth1");
        updated.setIpAddress("192.168.1.101");
        updated.setEnabled(false);

        when(interfaceService.updateInterface(eq(deviceId), eq(interfaceId), any(UpdateInterfaceRequest.class)))
                .thenReturn(Optional.of(updated));

        // Act & Assert
        mockMvc.perform(put("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("eth1"))
                .andExpect(jsonPath("$.ipAddress").value("192.168.1.101"))
                .andExpect(jsonPath("$.enabled").value(false));
    }

    @Test
    void updateInterface_interfaceDoesNotExist_returns404() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");

        when(interfaceService.updateInterface(eq(deviceId), eq(interfaceId), any(UpdateInterfaceRequest.class)))
                .thenReturn(Optional.empty());

        // Act & Assert
        mockMvc.perform(put("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound());
    }

    @Test
    void updateInterface_invalidRequest_returns400() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setIpAddress("invalid-ip");

        when(interfaceService.updateInterface(eq(deviceId), eq(interfaceId), any(UpdateInterfaceRequest.class)))
                .thenThrow(new IllegalArgumentException("Invalid IP address"));

        // Act & Assert
        mockMvc.perform(put("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteInterface_interfaceExists_returns204() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";

        when(interfaceService.deleteInterface(deviceId, interfaceId)).thenReturn(true);

        // Act & Assert
        mockMvc.perform(delete("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteInterface_interfaceDoesNotExist_returns404() throws Exception {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";

        when(interfaceService.deleteInterface(deviceId, interfaceId)).thenReturn(false);

        // Act & Assert
        mockMvc.perform(delete("/api/devices/{deviceId}/interfaces/{interfaceId}", deviceId, interfaceId))
                .andExpect(status().isNotFound());
    }

    private NetworkInterface createTestInterface(String id, String deviceId, String name) {
        NetworkInterface iface = new NetworkInterface();
        iface.setId(id);
        iface.setDeviceId(deviceId);
        iface.setName(name);
        iface.setType(InterfaceType.ETHERNET);
        iface.setMacAddress("AA:BB:CC:DD:EE:FF");
        iface.setIpAddress("192.168.1.1");
        iface.setStatus(InterfaceStatus.UP);
        iface.setEnabled(true);
        return iface;
    }
}
